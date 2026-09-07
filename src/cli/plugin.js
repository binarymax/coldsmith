import { writeFile } from 'node:fs/promises'

import chalk from 'chalk'

import { logger } from '../core/logger.js'
import { fileExists, readJSON } from '../core/utils.js'
import { commonOptions, extendOptions, loadEnv, npmInstall } from './common.js'

export const usage = `

  usage: wintersmith plugin [options] <command>

  commands:

    ${chalk.bold('list')} - list available plugins
    ${chalk.bold('install')} <plugin> - install plugin

  options:

    -C, --chdir [path]      change the working directory
    -c, --config [path]     path to config

`

export const options = {}

extendOptions(options, commonOptions)

function clip(string, maxlen) {
  if (string.length <= maxlen) return string
  return string.slice(0, maxlen - 2).trim() + '..'
}

function normalizePluginName(name) {
  return name.replace(/^wintersmith-/, '')
}

/**
 * Search the npm registry for plugins.
 *
 * Wintersmith 2 used api.npms.io, which has since shut down. This is the
 * registry's own search endpoint.
 */
async function fetchListing() {
  const url =
    'https://registry.npmjs.org/-/v1/search?text=keywords:wintersmith-plugin&size=250'
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Unexpected response when searching registry, HTTP ${response.status}`,
    )
  }
  const contentType = response.headers.get('content-type') || ''
  if (!/^application\/json/.test(contentType)) {
    throw new Error(`Invalid content-type: ${contentType}`)
  }

  const parsed = await response.json()
  return parsed.objects
    .map((result) => result.package)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function displayListing(list) {
  const display = list.map((plugin) => ({
    name: normalizePluginName(plugin.name),
    description: plugin.description || '',
    maintainers: (plugin.maintainers || []).map((v) => v.username).join(' '),
    homepage: plugin.links?.homepage ?? plugin.links?.npm,
  }))

  const pad = Math.max(0, ...display.map((item) => item.name.length))
  // getWindowSize() throws when stdout is not a tty, which is exactly what
  // happens when this listing is piped somewhere.
  const maxw = (process.stdout.columns || 80) - 2
  const margin = ' '.repeat(pad)

  for (const plugin of display) {
    let line = `${plugin.name.padStart(pad)}  ${clip(plugin.description, maxw - pad - 2)}`
    const left = maxw - line.length
    if (left > plugin.maintainers.length) {
      line += chalk.grey(plugin.maintainers.padStart(left))
    }
    logger.info(line.replace(/^\s*(\S+) {2}/, (m) => chalk.bold(m)))
    if (plugin.homepage != null && plugin.homepage.length < maxw - pad - 2) {
      logger.info(`${margin}  ${chalk.gray(plugin.homepage)}`)
    }
    logger.info('')
  }
}

async function installPlugin(env, list, name) {
  const plugin = list.find(
    (p) => normalizePluginName(p.name) === normalizePluginName(name),
  )
  if (!plugin) {
    throw new Error(`Unknown plugin: ${name}`)
  }

  const configFile = env.config.__filename
  const packageFile = env.resolvePath('package.json')

  if (!(await fileExists(packageFile))) {
    logger.warn('package.json missing, creating minimal package')
    await writeFile(packageFile, '{\n  "dependencies": {},\n  "private": true\n}\n')
  }

  logger.verbose(`installing ${plugin.name}`)
  await npmInstall([plugin.name], env.workDir)

  const config = await readJSON(configFile)
  config.plugins ??= []
  if (!config.plugins.includes(plugin.name)) {
    config.plugins.push(plugin.name)
  }

  logger.verbose(`saving config file: ${configFile}`)
  await writeFile(configFile, JSON.stringify(config, null, 2) + '\n')
}

export default async function main(argv) {
  const action = argv._[3]

  if (action == null) {
    console.log(usage)
    process.exit(0)
  }

  try {
    switch (action) {
      case 'list':
        displayListing(await fetchListing())
        break
      case 'install': {
        const [env, list] = await Promise.all([loadEnv(argv), fetchListing()])
        await installPlugin(env, list, argv._[4])
        break
      }
      default:
        throw new Error(`Unknown plugin action: ${action}`)
    }
  } catch (error) {
    logger.error(error.message, error)
    process.exit(1)
  }

  process.exit(0)
}
