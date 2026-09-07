/** EJS template plugin. */

import { readFile } from 'node:fs/promises'

import ejs from 'ejs'

export default function (env, callback) {
  class EjsTemplate extends env.TemplatePlugin {
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

  EjsTemplate.fromFile = async function (filepath) {
    const buffer = await readFile(filepath.full)
    // `filename` lets `include('./partial')` resolve relative to this file;
    // `root` additionally makes `include('/partial')` resolve from the
    // templates directory, whatever depth the including template sits at.
    //
    // `cache` is deliberately left at its default of false. EJS resolves
    // includes at render time, so an uncached include is re-read from disk on
    // every render - which is what lets the preview server pick up an edited
    // partial without a restart.
    const conf = {
      ...(env.config.ejs || {}),
      filename: filepath.full,
      root: env.templatesPath,
    }
    return new this(ejs.compile(buffer.toString(), conf))
  }

  env.registerTemplatePlugin('**/*.ejs', EjsTemplate)
  callback()
}
