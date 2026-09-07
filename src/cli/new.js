import { cp, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { logger } from '../core/logger.js'
import { fileExists } from '../core/utils.js'
import { getStorageDir, npmInstall } from './common.js'

/** Site templates, from the bundled examples and the user's storage directory. */
async function loadTemplates() {
  const templates = {}
  const directories = [
    path.join(import.meta.dirname, '..', '..', 'examples'),
    path.join(getStorageDir(), 'templates'),
  ]

  for (const directory of directories) {
    if (!(await fileExists(directory))) continue
    for (const filename of await readdir(directory)) {
      const full = path.join(directory, filename)
      if ((await stat(full)).isDirectory()) {
        templates[filename] = full
      }
    }
  }
  return templates
}

// Usage lists the available templates, so it has to be resolved up front.
const templates = await loadTemplates()

export const usage = `

  usage: coldsmith new [options] <path>

  creates a skeleton site in <path>

  options:

    -f, --force             overwrite existing files
    -T, --template <name>   template to create new site from (defaults to 'blog')

    available templates are: ${Object.keys(templates).join(', ')}

  example:

    create a new site in your home directory
    $ coldsmith new ~/my-blog

`

export const options = {
  string: ['template'],
  boolean: ['force'],
  alias: {
    force: 'f',
    template: 'T',
  },
  default: {
    template: 'blog',
  },
}

export default async function createSite(argv) {
  const location = argv._[3]
  if (location == null || !location.length) {
    logger.error('you must specify a location')
    return
  }

  if (templates[argv.template] == null) {
    logger.error(`unknown template '${argv.template}'`)
    return
  }

  const from = templates[argv.template]
  const to = path.resolve(location)

  logger.info(
    `initializing new coldsmith site in ${to} using template ${argv.template}`,
  )

  try {
    logger.verbose(`checking validity of ${to}`)
    if ((await fileExists(to)) && !argv.force) {
      throw new Error(`${to} already exists. Add --force to overwrite`)
    }

    logger.verbose(`recursive copy ${from} -> ${to}`)
    await cp(from, to, { recursive: true, force: true })

    if (await fileExists(path.join(to, 'package.json'))) {
      logger.verbose('installing template dependencies')
      await npmInstall([], to)
    }
  } catch (error) {
    logger.error(error.message, error)
    process.exit(1)
  }

  logger.info('done!')
}
