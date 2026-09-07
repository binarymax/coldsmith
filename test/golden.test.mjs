/**
 * Golden-output tests.
 *
 * Each site is built with whatever CLI `resolveCli()` finds and compared, byte
 * for byte, against a snapshot committed under test/golden/. This is the whole
 * safety net for the CoffeeScript-to-JavaScript port: the implementation
 * changes underneath, the rendered bytes must not.
 *
 * When output changes deliberately - a markdown or highlighter upgrade will do
 * it - re-baseline with `npm run test:update` and review the diff.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { buildSite, cleanup, resolveCli } from './support/cli.mjs'
import { diff, read, snapshot } from './support/snapshot.mjs'
import { goldenDir, isAvailable, normalizeLog, sites } from './support/sites.mjs'

test(`using CLI entry point: ${resolveCli()}`, () => {})

for (const site of sites) {
  test(`golden output: ${site.name}`, async (t) => {
    if (!isAvailable(site)) {
      t.skip(`dependencies missing - ${site.hint}`)
      return
    }
    const dir = goldenDir(site.name)
    if (!existsSync(dir)) {
      t.skip(`no golden snapshot yet - run \`npm run test:update\``)
      return
    }

    const built = await buildSite(site.dir)
    try {
      const actual = await snapshot(built.output)
      const golden = await read(dir)
      const problems = diff(golden, actual)
      assert.equal(
        problems.length,
        0,
        `build output for '${site.name}' changed:\n\n${problems.join('\n\n')}`,
      )

      const log = normalizeLog(built.stdout, built)
      const goldenLog = await readFile(path.join(dir, 'stdout.txt'), 'utf8')
      assert.equal(
        log,
        goldenLog,
        `CLI output for '${site.name}' changed - this covers ContentTree.inspect()`,
      )
    } finally {
      await cleanup(built.output)
    }
  })
}
