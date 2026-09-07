import chalk from 'chalk'
import parseArgv from 'minimist'

import { logger } from '../core/logger.js'
import { extendOptions } from './common.js'
import version from './version.js'

// An explicit map, rather than requiring whatever string the user typed.
const COMMANDS = {
  build: () => import('./build.js'),
  preview: () => import('./preview.js'),
  new: () => import('./new.js'),
  plugin: () => import('./plugin.js'),
}

const usage = `

  usage: wintersmith [options] [command]

  commands:

    ${chalk.bold('build')} [options] - build a site
    ${chalk.bold('preview')} [options] - run local webserver
    ${chalk.bold('new')} <location> - create a new site
    ${chalk.bold('plugin')} - manage plugins

    also see [command] --help

  global options:

    -v, --verbose   show debug information
    -q, --quiet     only output critical errors
    -V, --version   output version and exit
    -h, --help      show help

`

const globalOptions = {
  boolean: ['verbose', 'quiet', 'version', 'help'],
  alias: {
    verbose: 'v',
    quiet: 'q',
    version: 'V',
    help: 'h',
  },
}

export async function main(argv) {
  let opts = parseArgv(argv, globalOptions)
  const name = opts._[2]

  let command = null
  if (name != null) {
    if (!(name in COMMANDS)) {
      console.log(`'${name}' - no such command`)
      process.exit(1)
    }
    command = await COMMANDS[name]()
  }

  if (opts.version) {
    console.log(version)
    process.exit(0)
  }

  if (opts.help || !command) {
    console.log(command ? command.usage : usage)
    process.exit(0)
  }

  if (opts.verbose) {
    logger.transports[0].level = argv.includes('-vv') ? 'silly' : 'verbose'
  }

  if (opts.quiet) {
    logger.transports[0].quiet = true
  }

  extendOptions(command.options, globalOptions)
  opts = parseArgv(argv, command.options)
  return command.default(opts)
}
