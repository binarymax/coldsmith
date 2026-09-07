/** Template loading and the base class every template plugin extends. */

import path from 'node:path'

import { minimatch } from 'minimatch'

import { callUser, dual, readdirRecursive } from './utils.js'

/**
 * A template plugin implements a `render` instance method and a `fromFile`
 * class method.
 *
 * A function constructor rather than an ES class, for the same reason as
 * ContentPlugin: CoffeeScript 1.x subclasses call the parent constructor as a
 * plain function, which an ES class rejects. See content.js.
 */
export function TemplatePlugin() {}

/**
 * Render this template with *locals*, producing a stream or buffer.
 * Implementations may return a promise or take a callback.
 */
TemplatePlugin.prototype.render = function () {
  throw new Error('Not implemented.')
}

/**
 * Build an instance from *filepath*, an object with the full and
 * templates-directory-relative paths to the file.
 */
TemplatePlugin.fromFile = function () {
  throw new Error('Not implemented.')
}

/**
 * Load every template in the environment's templates directory.
 *
 * Returns a map of {<relative filename>: <TemplatePlugin instance>}.
 * Dual-signature: returns a promise, or takes a trailing callback.
 */
export function loadTemplates(env, callback) {
  const promise = (async () => {
    const templates = {}
    const filenames = await readdirRecursive(env.templatesPath)

    await Promise.all(
      filenames.map(async (filename) => {
        const filepath = {
          full: path.join(env.templatesPath, filename),
          relative: filename,
        }

        // Later registrations win, so search backwards.
        let plugin = null
        for (let i = env.templatePlugins.length - 1; i >= 0; i--) {
          if (minimatch(filepath.relative, env.templatePlugins[i].pattern)) {
            plugin = env.templatePlugins[i]
            break
          }
        }
        // Files no template plugin claims are simply not templates.
        if (plugin == null) return

        let template
        try {
          template = await callUser(plugin.class.fromFile, plugin.class, [filepath])
        } catch (error) {
          error.message = `template ${filepath.relative}: ${error.message}`
          throw error
        }
        // Only store on success. Wintersmith 2 stored the template even when
        // fromFile had failed, leaving `undefined` in the map.
        templates[filepath.relative] = template
      }),
    )

    return templates
  })()

  return dual(promise, callback)
}
