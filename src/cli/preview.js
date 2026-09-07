import { Config } from '../core/config.js'
import { logger } from '../core/logger.js'
import { commonOptions, commonUsage, extendOptions, loadEnv } from './common.js'

export const usage = `

  usage: coldsmith preview [options]

  options:

    -p, --port [port]             port to run server on (defaults to ${Config.defaults.port})
    -H, --hostname [host]         host to bind server onto (defaults to INADDR_ANY)
    ${commonUsage}

    all options can also be set in the config file

  examples:

    preview using a config file (assuming config.json is found in working directory):
    $ coldsmith preview

`

export const options = {
  string: ['port', 'hostname'],
  alias: {
    port: 'p',
    hostname: 'H',
  },
}

extendOptions(options, commonOptions)

export default async function preview(argv) {
  logger.info('starting preview server')
  try {
    const env = await loadEnv(argv)
    await env.preview()
  } catch (error) {
    logger.error(error.message, error)
    process.exit(1)
  }
}
