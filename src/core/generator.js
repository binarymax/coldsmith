/** Running content generators and folding their output into a content tree. */

import { ContentPlugin, ContentTree } from './content.js'
import { callUser, dual } from './utils.js'

/**
 * Run *generator* against *contents* and return its output as a ContentTree.
 *
 * Dual-signature: returns a promise, or takes a trailing callback.
 */
export function runGenerator(env, contents, generator, callback) {
  const promise = (async () => {
    const groups = env.getContentGroups()

    // Turn the plain object a generator returns into content tree instances,
    // and stamp the metadata the renderer needs onto each plugin instance.
    const resolve = (root, items) => {
      for (const [key, item] of Object.entries(items)) {
        if (ContentTree.reserved.has(key)) {
          throw new Error(
            `'${key}' is a reserved name and cannot be used for generated content`,
          )
        }
        if (item instanceof ContentPlugin) {
          item.parent = root
          item.__env = env
          item.__filename = 'generator'
          item.__plugin = generator
          root[key] = item
          root._[generator.group].push(item)
        } else if (item instanceof Object) {
          const tree = new ContentTree(key, groups)
          tree.parent = root
          tree.parent._.directories.push(tree)
          root[key] = tree
          resolve(root[key], item)
        } else {
          throw new Error(
            `Invalid item for '${key}' encountered when resolving generator output`,
          )
        }
      }
    }

    const generated = await callUser(generator.fn, null, [contents])
    const tree = new ContentTree('', groups)
    resolve(tree, generated)
    return tree
  })()

  return dual(promise, callback)
}
