#!/usr/bin/env node
/**
 * Regenerate the golden snapshots from the current implementation.
 *
 * Run this only when output has changed on purpose, and read the resulting
 * `git diff` before committing it. That diff is the entire point of the
 * exercise.
 */

import { writeFile } from 'node:fs/promises'

import { buildSite, cleanup, resolveCli } from './support/cli.mjs'
import { snapshot, write } from './support/snapshot.mjs'
import { goldenDir, isAvailable, normalizeLog, sites } from './support/sites.mjs'

console.log(`recording golden output using ${resolveCli()}\n`)

let skipped = 0
for (const site of sites) {
  if (!isAvailable(site)) {
    console.log(`  ${site.name}: skipped (${site.hint})`)
    skipped++
    continue
  }
  const built = await buildSite(site.dir)
  try {
    const snap = await snapshot(built.output)
    const dir = goldenDir(site.name)
    await write(dir, snap)
    await writeFile(`${dir}/stdout.txt`, normalizeLog(built.stdout, built))
    console.log(
      `  ${site.name}: ${Object.keys(snap.files).length} output files recorded`,
    )
  } finally {
    await cleanup(built.output)
  }
}

if (skipped > 0) {
  console.log(`\n${skipped} site(s) skipped - their snapshots were left alone.`)
}
