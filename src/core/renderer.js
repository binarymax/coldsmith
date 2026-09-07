/** Rendering a content tree to a directory. */

import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Stream } from 'node:stream'

import { ContentTree } from './content.js'
import { callUser, dual, extend, mapLimit, pump } from './utils.js'

/**
 * Run the view for *content* and return whatever it produces: a stream, a
 * buffer, or null to skip this item.
 *
 * Dual-signature: returns a promise, or takes a trailing callback.
 */
export function renderView(env, content, locals, contents, templates, callback) {
  const promise = (async () => {
    // env and contents are always available to a view.
    const viewLocals = { env, contents }
    extend(viewLocals, locals)

    let view = content.view
    if (typeof view === 'string') {
      const name = view
      view = env.views[name]
      if (view == null) {
        throw new Error(
          `content '${content.filename}' specifies unknown view '${name}'`,
        )
      }
    }

    try {
      return await callUser(view, content, [env, viewLocals, contents, templates])
    } catch (error) {
      error.message = `${content.filename}: ${error.message}`
      throw error
    }
  })()

  return dual(promise, callback)
}

/**
 * Render *contents* to *outputDir*, creating it if needed.
 *
 * Dual-signature: returns a promise, or takes a trailing callback.
 */
export function render(env, outputDir, contents, templates, locals, callback) {
  const promise = (async () => {
    env.logger.info(`rendering tree:\n${ContentTree.inspect(contents, 1)}\n`)
    env.logger.verbose(`render output directory: ${outputDir}`)

    const renderPlugin = async (content) => {
      const result = await renderView(env, content, locals, contents, templates)

      if (!(result instanceof Stream) && !(result instanceof Buffer)) {
        env.logger.verbose(`skipping ${content.url}`)
        return
      }

      const destination = path.join(outputDir, content.filename)
      env.logger.verbose(`writing content ${content.url} to ${destination}`)
      await mkdir(path.dirname(destination), { recursive: true })
      const writeStream = createWriteStream(destination)

      if (result instanceof Stream) {
        await pump(result, writeStream)
      } else {
        await new Promise((resolve, reject) => {
          writeStream.end(result, (error) => (error ? reject(error) : resolve()))
        })
      }
    }

    const items = ContentTree.flatten(contents)
    await mapLimit(items, env.config._fileLimit, renderPlugin)
  })()

  return dual(promise, callback)
}
