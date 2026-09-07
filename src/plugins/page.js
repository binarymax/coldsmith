/** The Page base class: content with metadata, html, and a template to render it. */

import path from 'node:path'
import vm from 'node:vm'

import slugify from 'slugg'

function replaceAll(string, map) {
  const re = new RegExp(Object.keys(map).join('|'), 'gi')
  return string.replace(re, (match) => map[match])
}

export default function (env, callback) {
  /**
   * Content view for pages with a `template` matching one of *templates*.
   * Produces nothing when the template is 'none'.
   */
  function templateView(env, locals, contents, templates, callback) {
    if (this.template === 'none') {
      return callback(null, null)
    }

    const template = templates[path.normalize(this.template)]
    if (template == null) {
      callback(
        new Error(
          `page '${this.filename}' specifies unknown template '${this.template}'`,
        ),
      )
      return
    }

    const ctx = { page: this }
    env.utils.extend(ctx, locals)

    template.render(ctx, callback)
  }

  /**
   * A function constructor, not an ES class - see content.js. Page is the base
   * class nearly every third-party plugin extends, and those plugins were
   * compiled by CoffeeScript 1.x.
   */
  function Page(filepath, metadata) {
    this.filepath = filepath
    this.metadata = metadata
  }

  Page.prototype = Object.create(env.ContentPlugin.prototype)
  Page.prototype.constructor = Page
  // Inherit the statics, notably `property`, which subclasses call.
  Object.setPrototypeOf(Page, env.ContentPlugin)

  Object.assign(Page.prototype, {
    /**
     * The output filename, from the filename template (the `filenameTemplate`
     * config key, default ':file.html').
     *
     * Available placeholders:
     *
     *   :year     - full year from page.date
     *   :month    - zero-padded month from page.date
     *   :day      - zero-padded day from page.date
     *   :title    - slugified page.title
     *   :basename - filename from the page's path
     *   :file     - basename without the extension
     *   :ext      - file extension
     *   :dirname  - directory the page lives in
     *
     * JavaScript wrapped in double moustaches is evaluated, with this page
     * available as `page` and the environment as `env`.
     *
     * For a page at somedir/myfile.md dated 2001-02-03:
     *
     *   :file.html (default)                    -> somedir/myfile.html
     *   /:year/:month/:day/index.html           -> 2001/02/03/index.html
     *   :year-:title.html                       -> somedir/2001-slugified-title.html
     *   /otherdir/{{ page.metadata.category }}/:basename
     *                                           -> otherdir/the-category/myfile.md
     */
    getFilename() {
      const template = this.filenameTemplate
      const dirname = path.dirname(this.filepath.relative)
      const basename = path.basename(this.filepath.relative)
      const file = env.utils.stripExtension(basename)
      const ext = path.extname(basename)

      let filename = replaceAll(template, {
        ':year': this.date.getFullYear(),
        ':month': ('0' + (this.date.getMonth() + 1)).slice(-2),
        ':day': ('0' + this.date.getDate()).slice(-2),
        ':title': slugify(this.title + ''),
        ':file': file,
        ':ext': ext,
        ':basename': basename,
        ':dirname': dirname,
      })

      // Evaluate code wrapped in double moustaches. Use with care.
      let context = null
      filename = filename.replace(/\{\{(.*?)\}\}/g, (match, code) => {
        context ??= vm.createContext({ env, page: this })
        return vm.runInContext(code, context)
      })

      if (filename[0] === '/') {
        // A leading slash is an absolute path in the content tree.
        return filename.slice(1)
      }
      // Otherwise it resolves from the page's own directory.
      return path.join(dirname, filename)
    },

    getUrl(base) {
      // Drop index.html for prettier links.
      return env.ContentPlugin.prototype.getUrl
        .call(this, base)
        .replace(/([/^])index\.html$/, '$1')
    },

    getView() {
      return this.metadata.view || 'template'
    },

    /** The page's html, with all urls resolved against *base*. */
    getHtml() {
      throw new Error('Not implemented.')
    },

    /** The html above the first cutoff marker. */
    getIntro(base) {
      const html = this.getHtml(base)
      const cutoffs = env.config.introCutoffs || ['<span class="more', '<h2', '<hr']
      let idx = Infinity
      for (const cutoff of cutoffs) {
        const i = html.indexOf(cutoff)
        if (i !== -1 && i < idx) idx = i
      }
      return idx !== Infinity ? html.substr(0, idx) : html
    },

    getFilenameTemplate() {
      return this.metadata.filename || env.config.filenameTemplate || ':file.html'
    },

    /** The template used by the 'template' view. */
    getTemplate() {
      return this.metadata.template || env.config.defaultTemplate || 'none'
    },
  })

  Page.property('html', 'getHtml')
  Page.property('intro', 'getIntro')
  Page.property('filenameTemplate', 'getFilenameTemplate')
  Page.property('template', 'getTemplate')

  Page.property('title', function () {
    return this.metadata.title || 'Untitled'
  })

  Page.property('date', function () {
    return new Date(this.metadata.date || 0)
  })

  Page.property('rfc822date', function () {
    return env.utils.rfc822(this.date)
  })

  Page.property('hasMore', function () {
    this._html ??= this.getHtml()
    this._intro ??= this.getIntro()
    this._hasMore ??= this._html.length > this._intro.length
    return this._hasMore
  })

  // Page is not registered as a content plugin itself; it is put on the
  // environment so that other plugins can subclass it.
  env.plugins.Page = Page

  env.registerView('template', templateView)

  callback()
}
