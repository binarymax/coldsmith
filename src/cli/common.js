import { spawn } from 'node:child_process'
import path from 'node:path'

import { Config } from '../core/config.js'
import { Environment } from '../core/environment.js'
import { logger } from '../core/logger.js'
import { fileExists } from '../core/utils.js'

export const commonOptions = {
  string: [
    'chdir',
    'config',
    'contents',
    'templates',
    'locals',
    'require',
    'plugins',
    'ignore',
  ],
  default: {
    config: './config.json',
    chdir: null,
  },
  alias: {
    config: 'c',
    chdir: 'C',
    contents: 'i',
    templates: 't',
    locals: 'L',
    require: 'R',
    plugins: 'P',
    ignore: 'I',
  },
}

export const commonUsage = [
  '-C, --chdir [path]            change the working directory',
  `  -c, --config [path]           path to config (defaults to ${commonOptions.default.config})`,
  `  -i, --contents [path]         contents location (defaults to ${Config.defaults.contents})`,
  `  -t, --templates [path]        template location (defaults to ${Config.defaults.templates})`,
  '  -L, --locals [path]           optional path to json file containing template context data',
  '  -R, --require                 comma separated list of modules to add to the template context',
  '  -P, --plugins                 comma separated list of modules to load as plugins',
  '  -I, --ignore                  comma separated list of files/glob-patterns to ignore',
].join('\n')

export function extendOptions(base, extra) {
  for (const type of ['string', 'boolean']) {
    base[type] ??= []
    if (extra[type] != null) base[type] = base[type].concat(extra[type])
  }
  for (const type of ['alias', 'default']) {
    base[type] ??= {}
    if (extra[type] != null) Object.assign(base[type], extra[type])
  }
}

/**
 * Create a wintersmith environment.
 * Options resolve as: argv > config file > defaults.
 */
export async function loadEnv(argv) {
  const workDir = path.resolve(argv.chdir || process.cwd())
  logger.verbose(`creating environment - work directory: ${workDir}`)

  // Load the config file if there is one.
  const configPath = path.join(workDir, argv.config)
  let config
  if (await fileExists(configPath)) {
    logger.info(`using config file: ${configPath}`)
    config = await Config.fromFile(configPath)
  } else {
    logger.verbose('no config file found')
    config = new Config()
  }

  // Override config options with anything given on the command line. These are
  // kept so they can be restored when the preview server reloads the config.
  config._cliopts = {}
  const excluded = ['_', 'chdir', 'config', 'clean']
  for (let [key, value] of Object.entries(argv)) {
    if (excluded.includes(key)) continue
    if (key === 'port') {
      value = Number(value)
    }
    if (['ignore', 'require', 'plugins'].includes(key)) {
      value = value.split(',')
      if (key === 'require') {
        // Handle the alias:module mapping.
        const reqs = {}
        for (const entry of value) {
          let [alias, module] = entry.split(':')
          if (module == null) {
            module = alias
            alias = module.replace(/\/$/, '').split('/').at(-1)
          }
          reqs[alias] = module
        }
        value = reqs
      }
    }
    config[key] = config._cliopts[key] = value
  }

  logger.verbose('config:', config)
  const env = new Environment(config, workDir, logger)

  for (const pathname of ['contents', 'templates']) {
    const resolved = env.resolvePath(env.config[pathname])
    if (!(await fileExists(resolved))) {
      throw new Error(`${pathname} path invalid (${resolved})`)
    }
  }

  return env
}

/**
 * Run `npm install` in *cwd*.
 *
 * Wintersmith 2 depended on the npm package and drove it through its
 * programmatic API, which npm removed in version 7 - so both `wintersmith new`
 * and `wintersmith plugin install` have been broken for years. Shelling out is
 * the supported way to do this, and it drops a very large dependency.
 */
export function npmInstall(args, cwd) {
  return new Promise((resolve, reject) => {
    logger.verbose(`running npm install ${args.join(' ')} in ${cwd}`)
    const child = spawn('npm', ['install', ...args], {
      cwd,
      stdio: 'inherit',
      // npm is a .cmd shim on Windows and cannot be spawned directly.
      shell: process.platform === 'win32',
    })
    child.on('error', (error) =>
      reject(
        new Error(
          `could not run npm (${error.message}). Is it installed and on PATH?`,
        ),
      ),
    )
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`npm install exited with code ${code}`)),
    )
  })
}

/** The user's wintersmith directory, used for cache and user templates. */
export function getStorageDir() {
  if (process.env.WINTERSMITH_PATH != null) return process.env.WINTERSMITH_PATH
  const home = process.env.HOME || process.env.USERPROFILE
  const dir = process.platform === 'win32' ? 'wintersmith' : '.wintersmith'
  return path.resolve(home, dir)
}
