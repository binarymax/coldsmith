/**
 * Locates and runs the wintersmith CLI.
 *
 * The golden-output tests have to run against both the old CoffeeScript
 * implementation and the ported JavaScript one, without being edited in
 * between. So the entry point is resolved dynamically:
 *
 *   1. $WINTERSMITH_CLI, if set (used to diff two implementations by hand)
 *   2. bin/wintersmith, once src/cli/index.js exists
 *   3. bin/dev/cli, the CoffeeScript entry point
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export function resolveCli() {
  if (process.env.WINTERSMITH_CLI) {
    return path.resolve(process.env.WINTERSMITH_CLI)
  }
  if (existsSync(path.join(repoRoot, 'src', 'cli', 'index.js'))) {
    return path.join(repoRoot, 'bin', 'wintersmith')
  }
  return path.join(repoRoot, 'bin', 'dev', 'cli')
}

export function run(args, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveCli(), ...args], {
      cwd,
      env: {
        ...process.env,
        // rfc822date() formats in local time, and pug templates may format
        // dates too. Without a fixed zone the golden output depends on where
        // the test happens to run.
        TZ: 'UTC',
        LANG: 'C',
        // chalk writes escape codes into the log, not into build output, but
        // keeping them out makes failure messages readable.
        FORCE_COLOR: '0',
      },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * Build *siteDir* into a fresh temporary directory and return its path.
 * The caller owns the directory and should pass it to `cleanup`.
 */
export async function buildSite(siteDir) {
  const output = await mkdtemp(path.join(tmpdir(), 'wintersmith-golden-'))
  const result = await run(['build', '--chdir', siteDir, '--output', output], {
    cwd: siteDir,
  })
  if (result.code !== 0) {
    await rm(output, { recursive: true, force: true })
    throw new Error(
      `build of ${siteDir} failed with code ${result.code}\n` +
        `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    )
  }
  return { output, ...result }
}

export function cleanup(dir) {
  return rm(dir, { recursive: true, force: true })
}
