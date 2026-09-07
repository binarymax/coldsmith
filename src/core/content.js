/**
 * The content tree and the base class every content plugin extends.
 */

import fs from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'
import util from 'node:util'

import chalk from 'chalk'
import { minimatch } from 'minimatch'

import { callUser, dual, mapLimit } from './utils.js'

// Options passed to minimatch for ignore and plugin matching.
const minimatchOptions = { dot: false }

/**
 * ContentPlugin - the base class for everything that turns a file into output.
 *
 * Deliberately a function constructor rather than an ES class, and it has to
 * stay that way. Every wintersmith plugin published before 3.0 was compiled by
 * CoffeeScript 1.x, whose inheritance helper calls the parent constructor as a
 * plain function:
 *
 *     function MarkdownPage() { return Page.apply(this, arguments) }
 *
 * An ES class throws `TypeError: Class constructor cannot be invoked without
 * 'new'` there, which would break the entire plugin ecosystem on upgrade.
 * A function constructor works with both that pattern and `class X extends
 * ContentPlugin`, so modern plugins are unaffected.
 *
 * The same applies to StaticFile, TemplatePlugin and Page.
 */
export function ContentPlugin() {}

/**
 * Define a read-only, *enumerable* property on the prototype.
 *
 * Enumerability is intentional and inherited from wintersmith 2: templates
 * iterate content instances and expect `url`, `title`, `date` and friends to
 * show up. Plugins call this as a class method, so it must remain a static.
 */
ContentPlugin.property = function (name, getter) {
  const get =
    typeof getter === 'string'
      ? function () {
          return this[getter].call(this)
        }
      : function () {
          return getter.call(this)
        }
  Object.defineProperty(this.prototype, name, { get, enumerable: true })
}

Object.assign(ContentPlugin.prototype, {
  /**
   * A view that renders this plugin: either the name of a registered view, or
   * a function `(env, locals, contents, templates, callback)`. The callback
   * takes a stream or buffer, or null to skip rendering this instance.
   */
  getView() {
    throw new Error('Not implemented.')
  },

  /** Where the result of this plugin's view is written, relative to the output directory. */
  getFilename() {
    throw new Error('Not implemented.')
  },

  /** This content's url, relative to *base*. */
  getUrl(base) {
    let filename = this.getFilename()
    base ??= this.__env.config.baseUrl
    if (!base.match(/\/$/)) base += '/'
    if (process.platform === 'win32') {
      filename = filename.replace(/\\/g, '/')
    }
    // url.resolve is legacy, but the WHATWG URL class cannot resolve against a
    // path-only base like '/blog/', which is exactly what baseUrl usually is.
    return url.resolve(base, filename)
  },

  /**
   * Vanity colour identifying this plugin in the content tree printout. One of
   * bold, italic, underline, inverse, yellow, cyan, white, magenta, green,
   * red, grey, blue, or none.
   */
  getPluginColor() {
    return 'cyan'
  },

  /** Extra detail shown next to this content in the tree printout. */
  getPluginInfo() {
    return `url: ${this.url}`
  },
})

ContentPlugin.property('view', 'getView')
ContentPlugin.property('filename', 'getFilename')
ContentPlugin.property('url', 'getUrl')
ContentPlugin.property('pluginColor', 'getPluginColor')
ContentPlugin.property('pluginInfo', 'getPluginInfo')

/**
 * Factory. *filepath* carries both paths for the file, e.g.
 * `{full: '/home/foo/site/contents/dir/file.ext', relative: 'dir/file.ext'}`.
 * Subclasses may return a promise or take a callback.
 */
ContentPlugin.fromFile = function () {
  throw new Error('Not implemented.')
}

/** Static file handler: serves content as-is. Last in the chain. */
export function StaticFile(filepath) {
  this.filepath = filepath
}

StaticFile.prototype = Object.create(ContentPlugin.prototype)
StaticFile.prototype.constructor = StaticFile
Object.setPrototypeOf(StaticFile, ContentPlugin)

Object.assign(StaticFile.prototype, {
  getView() {
    const filepath = this.filepath
    return function (...args) {
      const callback = args[args.length - 1]
      let stream
      try {
        stream = fs.createReadStream(filepath.full)
      } catch (error) {
        return callback(error)
      }
      callback(null, stream)
    }
  },

  getFilename() {
    return this.filepath.relative
  },

  getPluginColor() {
    return 'none'
  },
})

StaticFile.fromFile = async function (filepath) {
  // Nothing to read: the view streams the file straight to its destination.
  return new StaticFile(filepath)
}

/** Load the content plugin that handles *filepath*. */
export async function loadContent(env, filepath) {
  env.logger.silly(`loading ${filepath.relative}`)

  // Any file not claimed by a plugin is handled by the static file plugin.
  let plugin = { class: StaticFile, group: 'files' }

  // Later registrations win, so search backwards.
  for (let i = env.contentPlugins.length - 1; i >= 0; i--) {
    if (
      minimatch(filepath.relative, env.contentPlugins[i].pattern, minimatchOptions)
    ) {
      plugin = env.contentPlugins[i]
      break
    }
  }

  let instance
  try {
    instance = await callUser(plugin.class.fromFile, plugin.class, [filepath])
  } catch (error) {
    error.message = `${filepath.relative}: ${error.message}`
    throw error
  }

  if (instance != null) {
    // References to the plugin and file this instance came from.
    instance.__env = env
    instance.__plugin = plugin
    instance.__filename = filepath.full
  }
  return instance
}

/**
 * Names that cannot be used for content, because ContentTree exposes them.
 *
 * In wintersmith 2 a file with one of these names was silently dropped. Now it
 * is an error, which is easier to diagnose than output that quietly goes
 * missing.
 */
const RESERVED = new Set(['_', '__groupNames', 'filename', 'index', 'parent'])

function assertUsableName(key, treeName) {
  if (RESERVED.has(key)) {
    const where = treeName ? `'${treeName}'` : 'the content root'
    throw new Error(
      `'${key}' in ${where} is a reserved name and cannot be used for content`,
    )
  }
}

/**
 * A nested tree of content.
 *
 * Everything the tree needs about itself lives in private fields behind
 * prototype getters, so that a plain `for (const key in tree)` yields *only*
 * content. Templates, ContentTree.flatten, ContentTree.merge and the generator
 * resolver all depend on that. Public class fields would be enumerable own
 * properties and would show up as phantom entries in every tree - do not
 * convert these to fields.
 */
export class ContentTree {
  #groupNames
  #groups
  #filename
  #parent = null

  constructor(filename, groupNames = []) {
    this.#filename = filename
    this.#groupNames = groupNames
    this.#groups = { directories: [], files: [] }
    for (const name of groupNames) {
      this.#groups[name] = []
    }
  }

  get __groupNames() {
    return this.#groupNames
  }

  get _() {
    return this.#groups
  }

  get filename() {
    return this.#filename
  }

  get parent() {
    return this.#parent
  }

  set parent(value) {
    this.#parent = value
  }

  /** The `index.*` entry in this directory, if there is one. */
  get index() {
    for (const key in this) {
      if (key.slice(0, 6) === 'index.') return this[key]
    }
    return undefined
  }

  [util.inspect.custom]() {
    return ContentTree.inspect(this)
  }
}

/**
 * Recursively scan *directory* and build a ContentTree.
 *
 * Dual-signature: returns a promise, or takes a trailing callback.
 */
ContentTree.fromDirectory = function (env, directory, callback) {
  return dual(fromDirectory(env, directory), callback)
}

async function fromDirectory(env, directory) {
  const reldir = env.relativeContentsPath(directory)
  const tree = new ContentTree(reldir, env.getContentGroups())

  env.logger.silly(`creating content tree from ${directory}`)

  const filenames = (await readdir(directory)).sort()

  const filepaths = filenames.map((filename) => {
    const relname = path.join(reldir, filename)
    return { full: path.join(env.contentsPath, relname), relative: relname }
  })

  const included = filepaths.filter((filepath) => {
    for (const pattern of env.config.ignore) {
      if (minimatch(filepath.relative, pattern, minimatchOptions)) {
        env.logger.verbose(`ignoring ${filepath.relative} (matches: ${pattern})`)
        return false
      }
    }
    return true
  })

  // The file limit caps how many files are open at once. Results are collected
  // first and attached to the tree afterwards, so that group ordering follows
  // the sorted filenames rather than whichever read happened to finish first.
  const loaded = await mapLimit(
    included,
    env.config._fileLimit,
    async (filepath) => {
      const stats = await stat(filepath.full)
      if (stats.isDirectory()) {
        return {
          basename: path.basename(filepath.relative),
          subtree: await fromDirectory(env, filepath.full),
        }
      }
      if (stats.isFile()) {
        return {
          basename: path.basename(filepath.relative),
          instance: await loadContent(env, filepath),
        }
      }
      throw new Error(`Invalid file ${filepath.full}.`)
    },
  )

  for (const entry of loaded) {
    assertUsableName(entry.basename, reldir)
    if (entry.subtree) {
      entry.subtree.parent = tree
      tree[entry.basename] = entry.subtree
      tree._.directories.push(entry.subtree)
    } else if (entry.instance != null) {
      entry.instance.parent = tree
      tree[entry.basename] = entry.instance
      tree._[entry.instance.__plugin.group].push(entry.instance)
    }
  }

  return tree
}

/** A pretty, colourized rendering of *tree*. */
ContentTree.inspect = function (tree, depth = 0) {
  const pad = '  '.repeat(depth + 1)
  const keys = Object.keys(tree).sort((a, b) => {
    // Directories first, then by name.
    const ad = tree[a] instanceof ContentTree
    const bd = tree[b] instanceof ContentTree
    if (ad !== bd) return Number(bd) - Number(ad)
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })

  const lines = []
  for (const key of keys) {
    const value = tree[key]
    let line
    if (value instanceof ContentTree) {
      line = `${chalk.bold(key)}/\n${ContentTree.inspect(value, depth + 1)}`
    } else {
      let colorize = (s) => s
      if (value.pluginColor !== 'none') {
        colorize = chalk[value.pluginColor]
        if (!colorize) {
          throw new Error(
            `Plugin ${key} specifies invalid pluginColor: ${value.pluginColor}`,
          )
        }
      }
      line = `${colorize(key)} (${chalk.grey(value.pluginInfo)})`
    }
    lines.push(pad + line)
  }
  return lines.join('\n')
}

/** Every content plugin instance in *tree*, flattened into an array. */
ContentTree.flatten = function (tree) {
  let found = []
  for (const key in tree) {
    const value = tree[key]
    if (value instanceof ContentTree) {
      found = found.concat(ContentTree.flatten(value))
    } else {
      found.push(value)
    }
  }
  return found
}

/** Merge *tree* into *root*. */
ContentTree.merge = function (root, tree) {
  for (const key in tree) {
    const item = tree[key]
    assertUsableName(key, root.filename)
    if (item instanceof ContentPlugin) {
      root[key] = item
      item.parent = root
      root._[item.__plugin.group].push(item)
    } else if (item instanceof ContentTree) {
      if (root[key] == null) {
        root[key] = new ContentTree(key, item.__groupNames)
        root[key].parent = root
        root[key].parent._.directories.push(root[key])
      }
      if (root[key] instanceof ContentTree) {
        ContentTree.merge(root[key], item)
      }
    } else {
      throw new Error(`Invalid item in tree for '${key}'`)
    }
  }
}

ContentTree.reserved = RESERVED
