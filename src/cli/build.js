import { mkdir, rm } from 'node:fs/promises'

import chalk from 'chalk'

import { logger } from '../core/logger.js'
import { fileExists } from '../core/utils.js'
import { commonOptions, commonUsage, extendOptions, loadEnv } from './common.js'

export const usage = `

  usage: coldsmith build [options]

  options:

    -o, --output [path]           directory to write build-output (defaults to ./build)
    -X, --clean                   clean before building (warning: will recursively delete everything at output path)
    ${commonUsage}

    all options can also be set in the config file

  examples:

    build using a config file (assuming config.json is found in working directory):
    $ coldsmith build

    build using command line options:
    $ coldsmith build -o /var/www/public/ -T extra_data.json -C ~/my-blog

    or using both (command-line options will override config options):
    $ coldsmith build --config another_config.json --clean

`

export const options = {
  alias: {
    output: 'o',
    clean: 'X',
  },
  boolean: ['clean'],
  string: ['output'],
}

extendOptions(options, commonOptions)

async function prepareOutputDir(env, argv) {
  const outputDir = env.resolvePath(env.config.output)
  if (await fileExists(outputDir)) {
    if (!argv.clean) return
    logger.verbose(`cleaning - removing ${outputDir}`)
    await rm(outputDir, { recursive: true, force: true })
  } else {
    logger.verbose(`creating output directory ${outputDir}`)
  }
  await mkdir(outputDir, { recursive: true })
}

export default async function build(argv) {
  const start = Date.now()
  logger.info('building site')

  try {
    const env = await loadEnv(argv)
    await prepareOutputDir(env, argv)
    await env.build()
  } catch (error) {
    logger.error(error.message, error)
    process.exit(1)
  }

  logger.info(`done in ${chalk.bold(Date.now() - start)} ms\n`)
  process.exit()
}
