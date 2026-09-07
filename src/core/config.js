/** The configuration object. */

import {
  dual,
  fileExists,
  fileExistsSync,
  readJSON,
  readJSONSync,
} from './utils.js'

export class Config {
  static defaults = {
    // Directory containing the contents to be scanned.
    contents: './contents',
    // Glob patterns to ignore.
    ignore: [],
    // Context variables passed to views and templates.
    locals: {},
    // Modules or files to load as plugins.
    plugins: [],
    // Modules loaded and added to locals, as {name: module}.
    require: {},
    // Directory containing the templates.
    templates: './templates',
    // Directory to load custom views from.
    views: null,
    // Where the built site goes.
    output: './build',
    // Base url the site lives on, e.g. '/blog/'.
    baseUrl: '/',
    // Preview server settings.
    hostname: null, // INADDR_ANY
    port: 8080,
    // Options prefixed with _ are undocumented and should generally be left alone.
    _fileLimit: 40, // Maximum files to keep open at once.
    _restartOnConfChange: true, // Restart the preview server when the config changes.
  }

  constructor(options = {}) {
    for (const [option, value] of Object.entries(options)) {
      this[option] = value
    }
    for (const [option, defaultValue] of Object.entries(Config.defaults)) {
      this[option] ??= defaultValue
    }
  }
}

/** Read config from *path* as JSON. */
Config.fromFile = function (path, callback) {
  const promise = (async () => {
    if (!(await fileExists(path))) {
      throw new Error(`Config file at '${path}' does not exist.`)
    }
    const config = new Config(await readJSON(path))
    config.__filename = path
    return config
  })()
  return dual(promise, callback)
}

/** Read config from *path* as JSON, synchronously. */
Config.fromFileSync = function (path) {
  if (!fileExistsSync(path)) {
    throw new Error(`Config file at '${path}' does not exist.`)
  }
  const config = new Config(readJSONSync(path))
  config.__filename = path
  return config
}
