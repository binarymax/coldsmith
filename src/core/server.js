/** The preview server. */

import http from 'node:http'
import { Stream } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'

import chalk from 'chalk'
import chokidar from 'chokidar'
import mime from 'mime'
import { minimatch } from 'minimatch'

import { Config } from './config.js'
import { ContentTree } from './content.js'
import { runGenerator } from './generator.js'
import { renderView } from './renderer.js'
import { dual, pump } from './utils.js'

function colorCode(code) {
  switch (Math.floor(code / 100)) {
    case 2:
      return chalk.green(code)
    case 4:
      return chalk.yellow(code)
    case 5:
      return chalk.red(code)
    default:
      return code.toString()
  }
}

function normalizeUrl(anUrl) {
  if (anUrl[anUrl.length - 1] === '/') anUrl += 'index.html'
  if (anUrl.match(/^([^.]*[^/])$/)) anUrl += '/index.html'
  return decodeURI(anUrl)
}

function pathnameOf(requestUrl) {
  // request.url is origin-relative, so it needs a base to parse against.
  return new URL(requestUrl, 'http://localhost').pathname
}

function buildLookupMap(contents) {
  const map = {}
  for (const item of ContentTree.flatten(contents)) {
    map[normalizeUrl(item.url)] = item
  }
  return map
}

function lookupCharset(mimeType) {
  return /^text\/|^application\/(javascript|json|xml)/.test(mimeType)
    ? 'UTF-8'
    : null
}

/** Create a preview request handler. */
export function setup(env) {
  let contents = null
  let templates = null
  let locals = null
  let lookup = {} // url -> content

  // Tasks that block requests until they finish.
  const block = {
    contentsLoad: false,
    templatesLoad: false,
    viewsLoad: false,
    localsLoad: false,
  }

  const isReady = () => !Object.values(block).some(Boolean)

  const logError = (error) => {
    if (error != null) env.logger.error(error.message, error)
  }

  const loadContents = async () => {
    block.contentsLoad = true
    lookup = {}
    contents = null
    try {
      contents = await ContentTree.fromDirectory(env, env.contentsPath)
      lookup = buildLookupMap(contents)
    } finally {
      block.contentsLoad = false
    }
  }

  const loadTemplates = async () => {
    block.templatesLoad = true
    templates = null
    try {
      templates = await env.getTemplates()
    } finally {
      block.templatesLoad = false
    }
  }

  const loadViews = async () => {
    block.viewsLoad = true
    try {
      await env.loadViews()
    } finally {
      block.viewsLoad = false
    }
  }

  const loadLocals = async () => {
    block.localsLoad = true
    locals = null
    try {
      locals = await env.getLocals()
    } finally {
      block.localsLoad = false
    }
  }

  const contentWatcher = chokidar.watch(env.contentsPath, { ignoreInitial: true })

  // Reload the content tree on change.
  contentWatcher.on('all', async (type, filename) => {
    if (block.contentsLoad) return

    const relpath = env.relativeContentsPath(filename)
    for (const pattern of env.config.ignore) {
      if (minimatch(relpath, pattern)) {
        env.emit('change', relpath, true)
        return
      }
    }

    try {
      await loadContents()
    } catch (error) {
      logError(error)
      return
    }

    // Resolve the output filename for whatever changed.
    let contentFilename = null
    if (filename != null) {
      for (const content of ContentTree.flatten(contents)) {
        if (content.__filename === filename) {
          contentFilename = content.filename
          break
        }
      }
    }
    env.emit('change', contentFilename, false)
  })

  const templateWatcher = chokidar.watch(env.templatesPath, { ignoreInitial: true })
  templateWatcher.on('all', async () => {
    if (block.templatesLoad) return
    try {
      await loadTemplates()
      env.emit('change', null, false)
    } catch (error) {
      logError(error)
    }
  })

  let viewsWatcher = null
  if (env.config.views != null) {
    viewsWatcher = chokidar.watch(env.resolvePath(env.config.views), {
      ignoreInitial: true,
    })
    viewsWatcher.on('all', async () => {
      if (block.viewsLoad) return
      // Views are cached by the module loader; drop them so the edit is seen.
      env.invalidateModules()
      try {
        await loadViews()
        env.emit('change', null, false)
      } catch (error) {
        logError(error)
      }
    })
  }

  /**
   * Serve one request. Returns {code, pluginName}, or null when nothing in the
   * content tree matches the url.
   */
  const contentHandler = async (request, response) => {
    const uri = normalizeUrl(pathnameOf(request.url))
    env.logger.verbose(`contentHandler - ${uri}`)

    // Generators run per request so that generated content stays live.
    const generated = []
    for (const generator of env.generators) {
      generated.push(await runGenerator(env, contents, generator))
    }

    let tree = contents
    let generatorLookup = {}
    if (generated.length > 0) {
      tree = new ContentTree('', env.getContentGroups())
      for (const gentree of generated) {
        ContentTree.merge(tree, gentree)
      }
      generatorLookup = buildLookupMap(generated)
      ContentTree.merge(tree, contents)
    }

    const content = generatorLookup[uri] || lookup[uri]
    if (content == null) return null

    const pluginName = content.constructor.name

    let result
    try {
      result = await renderView(env, content, locals, tree, templates)
    } catch (error) {
      error.responseCode = 500
      error.pluginName = pluginName
      throw error
    }

    if (result == null) {
      // The plugin declined to render this one.
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('404 Not Found\n')
      return { code: 404, pluginName }
    }

    const mimeType = mime.getType(content.filename) ?? mime.getType(uri)
    const charset = lookupCharset(mimeType)
    const contentType = charset ? `${mimeType}; charset=${charset}` : mimeType

    if (result instanceof Stream) {
      response.writeHead(200, { 'Content-Type': contentType })
      await pump(result, response)
      return { code: 200, pluginName }
    }
    if (result instanceof Buffer) {
      response.writeHead(200, { 'Content-Type': contentType })
      response.write(result)
      response.end()
      return { code: 200, pluginName }
    }

    throw new Error(
      `View for content '${content.filename}' returned invalid response. Expected Buffer or Stream.`,
    )
  }

  const requestHandler = (request, response) => {
    const start = Date.now()
    const uri = pathnameOf(request.url)

    const handle = async () => {
      if (!block.contentsLoad && contents == null) await loadContents()
      if (!block.templatesLoad && templates == null) await loadTemplates()
      while (!isReady()) await sleep(50)
      return contentHandler(request, response)
    }

    handle().then(
      (outcome) => finish(null, outcome),
      (error) => finish(error, null),
    )

    function finish(error, outcome) {
      let code = outcome?.code
      const pluginName = outcome?.pluginName ?? error?.pluginName

      if (error != null || code == null) {
        // Unhandled, or something threw.
        code = error != null ? 500 : 404
        response.writeHead(code, { 'Content-Type': 'text/plain' })
        response.end(error != null ? error.message : '404 Not Found\n')
      }

      const delta = Date.now() - start
      let logstr = `${colorCode(code)} ${chalk.bold(uri)}`
      if (pluginName != null) logstr += ` ${chalk.grey(pluginName)}`
      logstr += chalk.grey(` ${delta}ms`)
      env.logger.info(logstr)

      if (error != null) env.logger.error(error.message, error)
    }
  }

  // Preload.
  loadContents().catch(logError)
  loadTemplates().catch(logError)
  loadViews().catch(logError)
  loadLocals().catch(logError)

  requestHandler.destroy = async () => {
    await Promise.all([
      contentWatcher.close(),
      templateWatcher.close(),
      viewsWatcher?.close(),
    ])
  }

  return requestHandler
}

/**
 * Run the preview server.
 *
 * Dual-signature: returns a promise for the server instance, or takes a
 * trailing callback.
 */
export function run(env, callback) {
  let server = null
  let handler = null

  const start = async () => {
    await env.loadPlugins()
    handler = setup(env)
    server = http.createServer(handler)

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(env.config.port, env.config.hostname)
    })

    return server
  }

  const stop = async () => {
    if (server == null) return
    // Replaces the server-destroy package: node can close idle and active
    // connections itself since 18.2.
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await handler.destroy()
    env.reset()
    server = null
  }

  const restart = async () => {
    env.logger.info('restarting server')
    await stop()
    return start()
  }

  if (env.config._restartOnConfChange && env.config.__filename != null) {
    env.logger.verbose(`watching config file ${env.config.__filename} for changes`)
    const configWatcher = chokidar.watch(env.config.__filename)
    configWatcher.on('change', async () => {
      let config
      try {
        config = Config.fromFileSync(env.config.__filename)
      } catch (error) {
        env.logger.error(`Error reloading config: ${error.message}`, error)
        return
      }

      // Restore any command line options passed in at startup.
      const cliopts = env.config._cliopts
      if (cliopts) {
        config._cliopts = {}
        for (const [key, value] of Object.entries(cliopts)) {
          config[key] = config._cliopts[key] = value
        }
      }

      env.setConfig(config)
      try {
        await restart()
      } catch (error) {
        env.logger.error(error.message, error)
        throw error
      }
      env.logger.verbose('config file change detected, server reloaded')
      env.emit('change')
    })
  }

  process.on('uncaughtException', (error) => {
    env.logger.error(error.message, error)
    process.exit(1)
  })

  env.logger.verbose('starting preview server')

  const promise = start().then((server) => {
    const host = env.config.hostname || 'localhost'
    const serverUrl = `http://${host}:${env.config.port}${env.config.baseUrl}`
    env.logger.info(`server running on: ${chalk.bold(serverUrl)}`)
    return server
  })

  return dual(promise, callback)
}
