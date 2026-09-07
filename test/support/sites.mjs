import { existsSync } from 'node:fs'
import path from 'node:path'

import { repoRoot } from './cli.mjs'

/**
 * The sites whose build output is pinned by the golden tests.
 *
 * `needs` names a directory that must exist for the site to be buildable -
 * example sites with third-party dependencies are skipped rather than failed
 * when they have not been installed.
 */
export const sites = [
  {
    name: 'fixture',
    dir: path.join(repoRoot, 'test', 'fixtures', 'site'),
  },
  {
    name: 'basic',
    dir: path.join(repoRoot, 'examples', 'basic'),
  },
  {
    name: 'blog',
    dir: path.join(repoRoot, 'examples', 'blog'),
    needs: path.join(repoRoot, 'examples', 'blog', 'node_modules'),
    hint: 'run `npm install` in examples/blog',
  },
  {
    // The ecosystem regression test. This site is built entirely by
    // third-party plugins - wintersmith-less, -browserify, -nunjucks and
    // -livereload - none of which have been touched since 2016 and all of
    // which were compiled from CoffeeScript 1.x. If a change breaks plugin
    // compatibility, this is where it shows up.
    //
    // Not run in CI: it installs 400-odd packages, several deprecated, from
    // unmaintained projects. Run it locally when touching the plugin API.
    name: 'webapp',
    dir: path.join(repoRoot, 'examples', 'webapp'),
    needs: path.join(repoRoot, 'examples', 'webapp', 'node_modules'),
    hint: 'run `npm install` in examples/webapp',
  },
]

export function goldenDir(name) {
  return path.join(repoRoot, 'test', 'golden', name)
}

export function isAvailable(site) {
  return !site.needs || existsSync(site.needs)
}

/**
 * Strip run-specific values out of the CLI's log output so it can be compared
 * across machines and across temporary build directories.
 */
export function normalizeLog(text, { output }) {
  return text
    .split(output)
    .join('{{OUTPUT}}')
    .split(repoRoot.replace(/\/$/, ''))
    .join('{{ROOT}}')
    .replace(/done in \d+ ms/, 'done in {{MS}} ms')
}
