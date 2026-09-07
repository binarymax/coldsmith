/**
 * Locates and runs the coldsmith CLI.
 *
 * Resolved at runtime rather than hardcoded: during the port from wintersmith
 * this let the same tests run unchanged against both implementations, which is
 * how each ported file was verified before the next was started.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export function resolveCli() {
  if (process.env.COLDSMITH_CLI) {
    return path.resolve(process.env.COLDSMITH_CLI)
  }
  return path.join(repoRoot, 'bin', 'coldsmith')
}

export function run(args, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveCli(), ...args], {
      cwd,
      env: {
        ...process.env,
        // rfc822date() formats in local time, and templates may format
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
  const output = await mkdtemp(path.join(tmpdir(), 'coldsmith-golden-'))
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
