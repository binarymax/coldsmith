/**
 * Snapshotting for the golden-output tests.
 *
 * A snapshot of a build directory is two things:
 *
 *   - manifest.json  every output file, with its sha256 and byte length
 *   - files/         verbatim copies of the text output, so that a failing
 *                    test produces a readable diff rather than "hash differs"
 *
 * Binary output (images) is recorded by hash only.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.xml',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.txt',
  '.svg',
  '.md',
])

export function isText(relativePath) {
  return TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
}

/**
 * Remove the few things that legitimately vary between runs.
 *
 * Applied identically to golden and actual output, so it can never cause a
 * false failure - it can only mask a real difference that happens to involve
 * one of these values.
 *
 *   - The current year. The blog example's layout renders a copyright line
 *     with `new Date().getFullYear()`, which would break the tests every
 *     January 1st.
 *   - Line endings, so the snapshots survive a checkout on Windows.
 */
export function normalize(text) {
  const year = String(new Date().getFullYear())
  return text.split('\r\n').join('\n').split(year).join('{{BUILD_YEAR}}')
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function walk(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true })
  const found = []
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await walk(root, relative)))
    } else {
      found.push(relative)
    }
  }
  return found
}

/** Read a build directory into an in-memory snapshot. */
export async function snapshot(buildDir) {
  const files = {}
  const contents = {}
  for (const relative of await walk(buildDir)) {
    const buffer = await readFile(path.join(buildDir, relative))
    if (isText(relative)) {
      const text = normalize(buffer.toString('utf8'))
      contents[relative] = text
      files[relative] = { sha256: sha256(text), bytes: text.length, text: true }
    } else {
      files[relative] = { sha256: sha256(buffer), bytes: buffer.length }
    }
  }
  return { files, contents }
}

/** Write a snapshot to *goldenDir*, replacing whatever was there. */
export async function write(goldenDir, snap) {
  await rm(goldenDir, { recursive: true, force: true })
  await mkdir(goldenDir, { recursive: true })
  await writeFile(
    path.join(goldenDir, 'manifest.json'),
    JSON.stringify(snap.files, null, 2) + '\n',
  )
  for (const [relative, text] of Object.entries(snap.contents)) {
    const target = path.join(goldenDir, 'files', relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text)
  }
}

/** Read a snapshot previously written by `write`. */
export async function read(goldenDir) {
  const files = JSON.parse(
    await readFile(path.join(goldenDir, 'manifest.json'), 'utf8'),
  )
  const contents = {}
  for (const [relative, entry] of Object.entries(files)) {
    if (entry.text) {
      contents[relative] = await readFile(
        path.join(goldenDir, 'files', relative),
        'utf8',
      )
    }
  }
  return { files, contents }
}

/**
 * Compare two snapshots. Returns a list of human-readable differences, most
 * useful first: missing/extra files before content changes.
 */
export function diff(golden, actual) {
  const problems = []
  const goldenNames = Object.keys(golden.files)
  const actualNames = Object.keys(actual.files)

  for (const name of goldenNames) {
    if (!(name in actual.files)) problems.push(`missing output file: ${name}`)
  }
  for (const name of actualNames) {
    if (!(name in golden.files)) problems.push(`unexpected output file: ${name}`)
  }
  if (problems.length > 0) return problems

  for (const name of goldenNames) {
    const a = golden.files[name]
    const b = actual.files[name]
    if (a.sha256 === b.sha256) continue
    if (a.text && b.text) {
      problems.push(
        `content differs: ${name}\n${inlineDiff(golden.contents[name], actual.contents[name])}`,
      )
    } else {
      problems.push(
        `binary content differs: ${name} (${a.bytes} bytes -> ${b.bytes} bytes)`,
      )
    }
  }
  return problems
}

/** Minimal line diff - enough to see what moved, without a dependency. */
function inlineDiff(expected, actual) {
  const a = expected.split('\n')
  const b = actual.split('\n')
  const lines = []
  const max = Math.max(a.length, b.length)
  let shown = 0
  for (let i = 0; i < max && shown < 20; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) lines.push(`  -${i + 1}| ${a[i]}`)
    if (b[i] !== undefined) lines.push(`  +${i + 1}| ${b[i]}`)
    shown++
  }
  if (shown === 0) lines.push('  (no line differences; whitespace only)')
  return lines.join('\n')
}
