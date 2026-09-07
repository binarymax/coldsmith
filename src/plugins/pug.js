/** Pug template plugin. */

import { readFile } from 'node:fs/promises'

import pug from 'pug'

export default function (env, callback) {
  class PugTemplate extends env.TemplatePlugin {
    constructor(fn) {
      super()
      this.fn = fn
    }

    render(locals, callback) {
      try {
        callback(null, Buffer.from(this.fn(locals)))
      } catch (error) {
        callback(error)
      }
    }
  }

  PugTemplate.fromFile = async function (filepath) {
    const buffer = await readFile(filepath.full)
    const conf = { ...(env.config.pug || {}), filename: filepath.full }
    return new this(pug.compile(buffer.toString(), conf))
  }

  env.registerTemplatePlugin('**/*.*(pug|jade)', PugTemplate)
  callback()
}
