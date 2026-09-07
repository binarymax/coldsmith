// Exercises the three things a user plugin can do: register a content plugin,
// register a generator, and hang a helper off the environment.
//
// Deliberately written as CommonJS with a callback signature - this is the
// shape every published wintersmith plugin has, and it must keep working.

var fs = require('fs')

module.exports = function (env, callback) {
  var options = { suffix: '!' }
  var configured = env.config.shout || {}
  for (var key in configured) {
    options[key] = configured[key]
  }

  // An ES class extending the CoffeeScript-era Page base class.
  class ShoutPage extends env.plugins.Page {
    constructor(filepath, text) {
      super(filepath, { template: 'page.pug', title: 'A shout' })
      this.text = text
    }

    getHtml() {
      return '<p>' + this.text.trim().toUpperCase() + options.suffix + '</p>\n'
    }

    getPluginColor() {
      return 'magenta'
    }
  }

  ShoutPage.fromFile = function (filepath, callback) {
    fs.readFile(filepath.full, function (error, buffer) {
      if (error) {
        callback(error)
        return
      }
      callback(null, new ShoutPage(filepath, buffer.toString()))
    })
  }

  env.registerContentPlugin('shouts', '**/*.shout', ShoutPage)

  // A generated page, rendered by a view returned from getView().
  class IndexPage extends env.plugins.Page {
    constructor(names) {
      super({ full: 'generated', relative: 'generated' }, { title: 'Index' })
      this.names = names
    }

    getFilename() {
      return 'generated/index.html'
    }

    getView() {
      var page = this
      return function (env, locals, contents, templates, callback) {
        var template = templates['list.pug']
        if (!template) {
          callback(new Error("missing template 'list.pug'"))
          return
        }
        var ctx = { page: page, names: page.names }
        env.utils.extend(ctx, locals)
        template.render(ctx, callback)
      }
    }
  }

  env.registerGenerator('generated', function (contents, callback) {
    var names = env.helpers.contentNames(contents).sort()
    callback(null, { 'index.page': new IndexPage(names) })
  })

  env.helpers.contentNames = function (contents) {
    // Walks the tree with a plain for-in. If ContentTree ever leaks its
    // internals as enumerable properties, this picks them up and the golden
    // output changes.
    var names = []
    for (var key in contents) {
      names.push(key)
    }
    return names
  }

  callback()
}
