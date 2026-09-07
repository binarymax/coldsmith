/**
 * Paginator plugin. Defaults can be overridden in config.json, e.g.
 * "paginator": {"perPage": 10}
 *
 * This is the reference example for writing a wintersmith plugin: it
 * registers a generator, subclasses the Page content plugin, and hangs a
 * helper off the environment for templates to use.
 */

module.exports = function (env, callback) {
  const options = {
    template: 'index.pug', // Template that renders the pages.
    articles: 'articles', // Directory containing the contents to paginate.
    first: 'index.html', // Filename and url for the first page.
    filename: 'page/%d/index.html', // Filename for the rest.
    perPage: 2, // Articles per page.
    ...(env.config.paginator || {}),
  }

  /** The articles found in *contents*, newest first. */
  function getArticles(contents) {
    return (
      contents[options.articles]._.directories
        // Each article is assumed to have its own directory.
        .map((item) => item.index)
        // Skip articles with no template.
        .filter((item) => item.template !== 'none')
        .sort((a, b) => b.date - a.date)
    )
  }

  /** A page of articles. */
  class PaginatorPage extends env.plugins.Page {
    constructor(pageNum, articles) {
      super(null, {})
      this.pageNum = pageNum
      this.articles = articles
    }

    getFilename() {
      return this.pageNum === 1
        ? options.first
        : options.filename.replace('%d', this.pageNum)
    }

    /** Note that this returns a *function*: a view, rather than a template name. */
    getView() {
      const page = this
      return function (env, locals, contents, templates, callback) {
        const template = templates[options.template]
        if (!template) {
          return callback(
            new Error(`unknown paginator template '${options.template}'`),
          )
        }

        const ctx = {
          articles: page.articles,
          pageNum: page.pageNum,
          prevPage: page.prevPage,
          nextPage: page.nextPage,
          page,
        }
        env.utils.extend(ctx, locals)

        template.render(ctx, callback)
      }
    }
  }

  // 'paginator' is the content group the generated pages belong to, i.e.
  // contents._.paginator.
  env.registerGenerator('paginator', async (contents) => {
    const articles = getArticles(contents)

    const numPages = Math.ceil(articles.length / options.perPage)
    const pages = []
    for (let i = 0; i < numPages; i++) {
      pages.push(
        new PaginatorPage(
          i + 1,
          articles.slice(i * options.perPage, (i + 1) * options.perPage),
        ),
      )
    }

    for (const [i, page] of pages.entries()) {
      page.prevPage = pages[i - 1]
      page.nextPage = pages[i + 1]
    }

    // The object returned here is merged into the content tree. Do not modify
    // the tree directly inside a generator - treat it as read-only.
    const rv = { pages: {} }
    for (const page of pages) {
      // The file extension is arbitrary.
      rv.pages[`${page.pageNum}.page`] = page
    }
    rv['index.page'] = pages[0]
    rv['last.page'] = pages[numPages - 1]
    return rv
  })

  // Make the helper available to templates as env.helpers.getArticles.
  env.helpers.getArticles = getArticles

  callback()
}
