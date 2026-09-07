import { readFileSync } from 'node:fs'

// Read at runtime from package.json. Wintersmith 2 wrote this file during the
// CoffeeScript compile step; there is no build step any more.
const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
)

export default pkg.version
