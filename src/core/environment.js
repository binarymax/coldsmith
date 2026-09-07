/** The wintersmith environment: configuration, plugins, and the build entry points. */

import { EventEmitter } from 'node:events'
import { readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Config } from './config.js'
import { ContentPlugin, ContentTree, StaticFile } from './content.js'
import { runGenerator } from './generator.js'
import { logger as defaultLogger } from './logger.js'
import { render } from './renderer.js'
import { TemplatePlugin, loadTemplates } from './templates.js'
import * as utilsNamespace from './utils.js'
import { callUser, dual, readJSONSync } from './utils.js'

// A module namespace is frozen; env.utils is public and plugins may extend it.
const utils = { ...utilsNamespace }

const ownRequire = createRequire(import.meta.url)

export class Environment extends EventEmitter {
  /**
   * *config* is a Config instance, *workDir* the working directory, and
   * *logger* anything implementing error, warn, info, verbose and silly.
   */
  constructor(config, workDir, logger) {
    super()
    this.logger = logger
    this.loadedModules = []
    this.workDir = path.resolve(workDir)
    // Resolves modules the way the site would, i.e. from its own node_modules.
    this.siteRequire = createRequire(path.join(this.workDir, 'noop.js'))
    // Bumped on reset so that re-imported modules miss the ESM cache.
    this.generation = 0
    this.setConfig(config)
    this.reset()
  }

  /** Reset the environment and drop any modules loaded on its behalf. */
  reset() {
    this.views = { none: (...args) => args[args.length - 1]() }
    this.generators = []
    this.plugins = { StaticFile }
    this.templatePlugins = []
    this.contentPlugins = []
    this.helpers = {}
    this.locals = {}
    this.localsLoaded = false

    this.invalidateModules()
  }

  /**
   * Drop every module loaded with `unloadOnReset`, so the next import re-reads
   * it from disk. The preview server calls this when a view changes.
   *
   * ESM has no cache eviction, so imports are versioned instead - see
   * loadModule. CommonJS modules reached through import() do land in the
   * require cache, and that can be cleared properly.
   */
  invalidateModules() {
    let id
    while ((id = this.loadedModules.pop())) {
      this.logger.verbose(`unloading: ${id}`)
      delete this.siteRequire.cache[id]
      delete ownRequire.cache[id]
    }
    this.generation++
  }

  setConfig(config) {
    this.config = config
    this.contentsPath = this.resolvePath(config.contents)
    this.templatesPath = this.resolvePath(config.templates)
  }

  /** Resolve *pathname* against the working directory. */
  resolvePath(pathname) {
    return path.resolve(this.workDir, pathname || '')
  }

  /** Resolve *pathname* against the contents directory. */
  resolveContentsPath(pathname) {
    return path.resolve(this.contentsPath, pathname || '')
  }

  /** Resolve *module* to an absolute path, the way node would. */
  resolveModule(module) {
    switch (module[0]) {
      case '.':
        return this.siteRequire.resolve(this.resolvePath(module))
      case '/':
        return this.siteRequire.resolve(module)
      default:
        try {
          // The site's own dependencies win over wintersmith's.
          return this.siteRequire.resolve(module)
        } catch {
          return ownRequire.resolve(module)
        }
    }
  }

  /** Resolve a path relative to the working directory. */
  relativePath(pathname) {
    return path.relative(this.workDir, pathname)
  }

  /** Resolve a path relative to the contents directory. */
  relativeContentsPath(pathname) {
    return path.relative(this.contentsPath, pathname)
  }

  /**
   * Register a content *plugin*. Files in the contents directory matching the
   * glob *pattern* are instantiated through the plugin's `fromFile` factory.
   * *group* determines where instances are collected under each directory,
   * e.g. a plugin in group 'textFiles' lands in `contents.somedir._.textFiles`.
   */
  registerContentPlugin(group, pattern, plugin) {
    this.logger.verbose(
      `registering content plugin ${plugin.name} that handles: ${pattern}`,
    )
    this.plugins[plugin.name] = plugin
    this.contentPlugins.push({ group, pattern, class: plugin })
  }

  /**
   * Register a template *plugin*. Files in the templates directory matching
   * the glob *pattern* are passed to the plugin's `fromFile` factory.
   */
  registerTemplatePlugin(pattern, plugin) {
    this.logger.verbose(
      `registering template plugin ${plugin.name} that handles: ${pattern}`,
    )
    this.plugins[plugin.name] = plugin
    this.templatePlugins.push({ pattern, class: plugin })
  }

  /**
   * Register a generator. It is called with the current content tree and
   * returns an object of nested ContentPlugin instances, which are merged into
   * the final tree.
   */
  registerGenerator(group, generator) {
    this.generators.push({ group, fn: generator })
  }

  /** Register a view. */
  registerView(name, view) {
    this.views[name] = view
  }

  /** Every registered content group. */
  getContentGroups() {
    const groups = []
    for (const plugin of this.contentPlugins) {
      if (!groups.includes(plugin.group)) groups.push(plugin.group)
    }
    for (const generator of this.generators) {
      if (!groups.includes(generator.group)) groups.push(generator.group)
    }
    return groups
  }

  /**
   * Import *module*, resolved from the working directory.
   *
   * CommonJS modules keep working: import() exposes `module.exports` as the
   * default export, which is unwrapped here, so a plugin written as
   * `module.exports = function (env, callback) {}` loads unchanged.
   */
  async loadModule(module, unloadOnReset = false) {
    if (module.endsWith('.coffee')) {
      throw new Error(
        `cannot load '${module}': CoffeeScript support was removed in ` +
          'wintersmith 3. Convert the file to JavaScript, or compile it ' +
          'before loading.',
      )
    }

    this.logger.silly(`loading module: ${module}`)
    const id = this.resolveModule(module)
    this.logger.silly(`resolved: ${id}`)

    let specifier = id
    if (path.isAbsolute(id)) {
      const url = pathToFileURL(id)
      // Versioning the specifier is the only way to re-import a module after a
      // reset; ESM has no cache eviction. The old copy is leaked, which is
      // acceptable for a preview server picking up edits.
      if (unloadOnReset) url.searchParams.set('wintersmith', this.generation)
      specifier = url.href
    }

    const namespace = await import(specifier)
    if (unloadOnReset) this.loadedModules.push(id)
    return namespace.default ?? namespace
  }

  /** Load a plugin *module*, either an id to import or an already-loaded function. */
  async loadPluginModule(module, callback) {
    const promise = (async () => {
      let id = 'unknown'
      try {
        if (typeof module === 'string') {
          id = module
          module = await this.loadModule(module)
        }
        await callUser(module, null, [this])
      } catch (error) {
        error.message = `Error loading plugin '${id}': ${error.message}`
        throw error
      }
    })()
    return dual(promise, callback)
  }

  /** Load a view module and register it. */
  async loadViewModule(id, callback) {
    const promise = (async () => {
      this.logger.verbose(`loading view: ${id}`)
      let module
      try {
        module = await this.loadModule(id, true)
      } catch (error) {
        error.message = `Error loading view '${id}': ${error.message}`
        throw error
      }
      // Views are registered under their basename *including* the extension,
      // so content selects them with `view: myview.js`.
      this.registerView(path.basename(id), module)
    })()
    return dual(promise, callback)
  }

  /** Load the default plugins, then anything in config.plugins. */
  loadPlugins(callback) {
    const promise = (async () => {
      for (const plugin of Environment.defaultPlugins) {
        this.logger.verbose(`loading default plugin: ${plugin}`)
        const module = await import(`../plugins/${plugin}.js`)
        await this.loadPluginModule(module.default ?? module)
      }
      for (const plugin of this.config.plugins) {
        this.logger.verbose(`loading plugin: ${plugin}`)
        await this.loadPluginModule(plugin)
      }
    })()
    return dual(promise, callback)
  }

  /** Load and register everything in the configured views directory. */
  loadViews(callback) {
    const promise = (async () => {
      if (this.config.views == null) return
      const filenames = await readdir(this.resolvePath(this.config.views))
      await Promise.all(
        filenames.map((filename) =>
          this.loadViewModule(`${this.config.views}/${filename}`),
        ),
      )
    })()
    return dual(promise, callback)
  }

  /** Build the content tree, running any registered generators. */
  getContents(callback) {
    const promise = (async () => {
      const contents = await ContentTree.fromDirectory(this, this.contentsPath)
      if (this.generators.length === 0) return contents

      const generated = []
      for (const generator of this.generators) {
        generated.push(await runGenerator(this, contents, generator))
      }
      if (generated.length === 0) return contents

      const tree = new ContentTree('', this.getContentGroups())
      for (const gentree of generated) {
        ContentTree.merge(tree, gentree)
      }
      ContentTree.merge(tree, contents)
      return tree
    })()
    return dual(promise, callback)
  }

  /** Load the templates. */
  getTemplates(callback) {
    return dual(loadTemplates(this), callback)
  }

  /**
   * Resolve the locals, loading any modules named by the `require` config key.
   *
   * Loading is deferred to here rather than done in the constructor, because
   * importing a module is asynchronous and a constructor cannot await.
   */
  getLocals(callback) {
    const promise = (async () => {
      if (this.localsLoaded) return this.locals

      if (typeof this.config.locals === 'string') {
        const filename = this.resolvePath(this.config.locals)
        this.logger.verbose(`loading locals from: ${filename}`)
        this.locals = readJSONSync(filename)
      } else {
        this.locals = this.config.locals
      }

      for (const [alias, id] of Object.entries(this.config.require)) {
        this.logger.verbose(
          `loading module '${id}' available in locals as '${alias}'`,
        )
        if (this.locals[alias] != null) {
          this.logger.warn(
            `module '${id}' overwrites previous local with the same key ('${alias}')`,
          )
        }
        try {
          this.locals[alias] = await this.loadModule(id)
        } catch (error) {
          this.logger.warn(`unable to load '${id}': ${error.message}`)
        }
      }

      this.localsLoaded = true
      return this.locals
    })()
    return dual(promise, callback)
  }

  /** Load plugins, views, contents, templates and locals. */
  load(callback) {
    const promise = (async () => {
      await Promise.all([this.loadPlugins(), this.loadViews()])
      const [contents, templates, locals] = await Promise.all([
        this.getContents(),
        this.getTemplates(),
        this.getLocals(),
      ])
      return { contents, templates, locals }
    })()
    return dual(promise, callback)
  }

  /**
   * Start the preview server.
   *
   * Note that the server instance becomes invalid if the config file changes
   * and the server restarts because of it; set _restartOnConfChange to false
   * to avoid that.
   */
  preview(callback) {
    const promise = (async () => {
      this.mode = 'preview'
      const server = await import('./server.js')
      return server.run(this)
    })()
    return dual(promise, callback)
  }

  /** Build the content tree and render it to *outputDir*. */
  build(outputDir, callback) {
    if (typeof outputDir === 'function') {
      callback = outputDir
      outputDir = null
    }
    const promise = (async () => {
      this.mode = 'build'
      const target = outputDir ?? this.resolvePath(this.config.output)
      const { contents, templates, locals } = await this.load()
      await render(this, target, contents, templates, locals)
    })()
    return dual(promise, callback)
  }
}

// Exposed for plugins.
Environment.prototype.utils = utils
Environment.prototype.ContentTree = ContentTree
Environment.prototype.ContentPlugin = ContentPlugin
Environment.prototype.TemplatePlugin = TemplatePlugin

/**
 * Create an environment. *config* can be a plain object, a Config instance, or
 * a path to a config file.
 */
Environment.create = function (config, workDir, log = defaultLogger) {
  if (typeof config === 'string') {
    // The working directory is wherever the config file lives.
    workDir ??= path.dirname(config)
    config = Config.fromFileSync(config)
  } else {
    workDir ??= process.cwd()
    if (!(config instanceof Config)) {
      config = new Config(config)
    }
  }
  return new Environment(config, workDir, log)
}

Environment.defaultPlugins = ['page', 'pug', 'markdown']
