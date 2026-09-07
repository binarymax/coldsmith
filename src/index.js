import { ContentPlugin, ContentTree } from './core/content.js'
import { Environment } from './core/environment.js'
import { TemplatePlugin } from './core/templates.js'

/** Create an environment. See Environment.create. */
export default function coldsmith(...args) {
  return Environment.create(...args)
}

export { ContentPlugin, ContentTree, Environment, TemplatePlugin }
