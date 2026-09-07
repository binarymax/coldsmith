/**
 * Preview server tests.
 *
 * The golden tests only cover `build`. The preview server is a separate code
 * path - its own content loading, watchers, generator handling and request
 * routing - so it gets driven here through the real CLI.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import test from 'node:test'

import { repoRoot, resolveCli } from './support/cli.mjs'

const SITE = path.join(repoRoot, 'test', 'fixtures', 'site')

/** Start a preview server and wait until it reports the url it is serving. */
async function startServer() {
  // A fixed port would collide with a concurrent run; the server prints the
  // one it actually bound, so any free-ish port works.
  const port = 20000 + Math.floor(Math.random() * 20000)

  const child = spawn(
    process.execPath,
    [resolveCli(), 'preview', '--chdir', SITE, '--port', String(port)],
    { cwd: SITE, env: { ...process.env, TZ: 'UTC', FORCE_COLOR: '0' } },
  )

  let output = ''
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server did not start:\n${output}`)),
      20000,
    )
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (output.includes('server running on')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited early with code ${code}:\n${output}`))
    })
  })

  await ready
  return {
    port,
    child,
    get output() {
      return output
    },
    stop() {
      child.kill('SIGKILL')
    },
  }
}

function get(server, urlPath) {
  return fetch(`http://localhost:${server.port}${urlPath}`)
}

test('preview server', async (t) => {
  const server = await startServer()
  t.after(() => server.stop())

  await t.test('serves a rendered page at a directory url', async () => {
    const response = await get(server, '/')
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'text/html; charset=UTF-8',
    )
    const body = await response.text()
    assert.match(body, /<title>Fixture Index \| Fixture Site<\/title>/)
    // Link resolution runs in preview too.
    assert.match(body, /href="\/pages\/deep\/note\.html"/)
  })

  await t.test('serves a nested page', async () => {
    const response = await get(server, '/pages/deep/note.html')
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Deeply Nested Note/)
  })

  await t.test('serves generated content', async () => {
    // Generators run per request, so this exercises a code path `build` shares
    // but reaches differently.
    const response = await get(server, '/generated/')
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Generated index/)
  })

  await t.test('streams static files with the right type', async () => {
    const text = await get(server, '/static.txt')
    assert.equal(text.status, 200)
    assert.match(text.headers.get('content-type'), /^text\/plain/)
    assert.match(await text.text(), /StaticFile plugin/)

    const image = await get(server, '/image.png')
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    const bytes = Buffer.from(await image.arrayBuffer())
    assert.equal(bytes.length, 89)
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
  })

  await t.test('serves content from a custom view', async () => {
    const response = await get(server, '/custom-view.html')
    assert.equal(response.status, 200)
    // views/reverse.js reverses the title.
    assert.match(await response.text(), /weiV motsuC/)
  })

  await t.test('404s for unknown urls', async () => {
    const response = await get(server, '/nothing-here.html')
    assert.equal(response.status, 404)
  })

  await t.test('404s for content whose view produces nothing', async () => {
    // no-view.md sets `view: none`, so the plugin declines to render.
    const response = await get(server, '/no-view.html')
    assert.equal(response.status, 404)
  })

  await t.test('does not serve ignored content', async () => {
    for (const url of ['/secret/hidden.html', '/ignored.tmp']) {
      assert.equal((await get(server, url)).status, 404, url)
    }
  })

  await t.test('picks up edits to content', async (t) => {
    const file = path.join(SITE, 'contents', 'winter-matter.md')
    const original = await readFile(file, 'utf8')
    t.after(() => writeFile(file, original))

    assert.doesNotMatch(await (await get(server, '/winter-matter.html')).text(), /RELOADED/)

    await writeFile(file, original.replace('Both forms', 'RELOADED forms'))

    // The watcher is asynchronous; poll rather than guess a delay.
    let body = ''
    for (let i = 0; i < 60; i++) {
      await sleep(100)
      body = await (await get(server, '/winter-matter.html')).text()
      if (body.includes('RELOADED')) break
    }
    assert.match(body, /RELOADED/, 'content watcher did not pick up the edit')
  })

  await t.test('logs each request', () => {
    assert.match(server.output, /200 \/static\.txt/)
    assert.match(server.output, /404 \/nothing-here\.html/)
  })
})
