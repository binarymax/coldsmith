# Coldsmith

Coldsmith is a hard fork of [wintersmith](https://github.com/jnordberg/wintersmith),
which was abandoned in 2019. Versioning continues wintersmith's line rather
than restarting: 3.0.0 is the release that would have followed 2.5.0. So
everything below is wintersmith's history, kept because coldsmith's code
descends from it directly.

## 3.0.0

_2026-09-07_

Forked from wintersmith 2.5.0 and ported to modern JavaScript. The CoffeeScript
is gone, there is no build step, and the dependency list went from 19 packages
to 13. Requires Node 20.11 or newer.

Most wintersmith sites will build unchanged under coldsmith. Read "Breaking
changes" before migrating.

### Migrating from wintersmith

1. `npm uninstall wintersmith && npm install coldsmith`
2. Run `coldsmith` instead of `wintersmith`. The commands, flags and
   `config.json` format are unchanged.
3. Third-party `wintersmith-*` plugins keep working — the plugin API is
   preserved, and `coldsmith plugin list` searches for both the
   `coldsmith-plugin` and `wintersmith-plugin` keywords.

### Breaking changes

_Relative to wintersmith 2.5.0._

- **The package and command are named `coldsmith`.** `WINTERSMITH_PATH` is
  still honoured, but the user storage directory is now `~/.coldsmith`.
- **Node 20.11+ required**, and the package is **ESM only**.
  `require('wintersmith')` no longer works; use
  `import coldsmith from 'coldsmith'`. The CLI is unaffected.
- **The bundled template language is EJS, not pug.** `src/plugins/pug.js` is
  gone, `.pug` and `.jade` files are no longer claimed by any default plugin,
  and `Environment.defaultPlugins` now loads `ejs` in pug's place. Templates
  are `.ejs`, configured under the `ejs` key in `config.json` (the `pug` key
  does nothing). To keep a pug site building, install `pug` yourself and add a
  three-line template plugin that calls `env.registerTemplatePlugin`, or use
  one of the published template plugins.

  Porting templates is mostly mechanical, with one exception: **EJS has no
  equivalent of pug's `extends`/`block` inheritance.** Build layouts out of
  partials instead — split the layout into a `_head`/`_foot` pair and pass the
  parts a page used to override in as locals. `include('name')` is an
  expression that returns the rendered partial as a string, so a block
  override becomes `include('_head', { header: include('_article-header') })`.
  The blog example is a worked conversion of a layout that used `block`,
  `block prepend`, `block append` and a mixin.

  Rendered markup differs even where templates are equivalent: pug controlled
  its own indentation, EJS emits exactly what you write, and EJS escapes `'`
  and `"` as `&#39;`/`&#34;` where pug left `'` alone.

- **CoffeeScript support is removed.** Plugins, views and config files written
  in CoffeeScript no longer load; convert them to JavaScript, or compile them
  first. Loading a `.coffee` file now fails with a message saying so. (Plugins
  that compile CoffeeScript _content_ themselves, such as
  wintersmith-browserify, are unaffected — they bring their own compiler.)
- **`markdown.smartLists` is a no-op.** marked removed the option and there is
  no replacement; its list handling is GFM-conformant now.
- **Unquoted front-matter dates that include a time are read as local, not
  UTC.** js-yaml 5 implements YAML 1.2, which does not parse timestamps into
  `Date` objects, so `date: 2012-03-04 10:20:30` reaches `new Date()` as a
  string. Write `2012-03-04T10:20:30Z` if you meant UTC. Date-only values are
  unaffected. (YAML 1.1 was considered, and rejected because it also parses
  `n:` as the boolean `false`.)
- **Rendered HTML changes slightly.** marked 0.5 → 18 and highlight.js 9 → 11
  mean different whitespace between blocks and different token class names in
  highlighted code. Restyling may be needed if you targeted highlight.js 9
  class names. Heading slugs are GitHub-compatible now, which drops a trailing
  dash on headings ending in punctuation.
- **Third-party plugins that subclass `MarkdownPage` or `JsonPage`** and were
  compiled by CoffeeScript 1.x will need updating.
  `ContentPlugin`, `StaticFile`, `TemplatePlugin` and `Page` — the documented
  base classes, and the ones essentially every plugin extends — are
  unaffected and still work with CoffeeScript 1.x inheritance.
- **A content file named `_`, `index`, `filename`, `parent` or `__groupNames`**
  is now an error. Previously it was silently dropped from the build.

### Fixed

- `wintersmith new` and `wintersmith plugin install` work again. Both drove
  npm through its programmatic API, which npm removed in version 7, so both
  have been broken since 2020. They shell out to npm now, and the `npm`
  package is no longer a dependency.
- `wintersmith plugin list` works again. It queried api.npms.io, which has
  shut down; it uses the npm registry's search endpoint now. It also no longer
  crashes when its output is piped.
- RSS `pubDate` is valid in August. The month table contained `' Aug'` with a
  leading space, producing a malformed date for every August post.
- RSS `pubDate` is correct in half-hour timezones. Asia/Kolkata (UTC+5:30) was
  rendered as `+0630`.
- Non-breaking spaces inside fenced code blocks survive rendering.
- `--verbose` shows error stacks and metadata again. winston 3 quietly stopped
  populating the field wintersmith read, years ago.
- A template whose `fromFile` failed is no longer stored as `undefined` in the
  template map.

### Changed

- The whole codebase is async/await. Every extension point — plugin modules,
  views, `fromFile` factories, `render` methods and generator functions — now
  accepts either a callback-style function or one returning a promise, so
  existing plugins keep working and new ones can be async.
- Public API methods (`Environment#build`, `#preview`, `#load`, `#getContents`,
  `#getTemplates`, `Config.fromFile`, …) return promises, and still accept a
  trailing callback.
- Dependencies: `async`, `mkdirp`, `rimraf`, `ncp`, `server-destroy`,
  `winston`, `npm` and `coffee-script` are all gone, replaced by Node built-ins
  or a small amount of local code. chalk 2 → 6, chokidar 2 → 5, mime 2 → 4,
  minimatch 3 → 10, js-yaml 3 → 5, highlight.js 9 → 11, marked 0.5 → 18.
  `pug` is replaced by `ejs` 6.
- Markdown link resolution no longer monkeypatches marked's inline lexer, and
  each page is parsed with its own marked instance rather than mutating
  process-global options.
- Content tree scanning is deterministic: content groups follow sorted
  filenames rather than whichever file read finished first.
- There is a test suite. There was not one before.

---

# Wintersmith history

Releases below are wintersmith's, before the fork.

## 2.5.0

_2018-11-19_

- Switch from `jade-legacy` to `pug` (thanks @sirodoht @VaelynPhi @SuriyaaKudoIsc @yusufhm)
- Upgrade to winston 3
- Upgrade to mime 2
- Upgrade to npm 6
- Update other dependencies minor versions (see https://github.com/jnordberg/wintersmith/commit/6e23ba624bbcd39f4a234429255991052bb780f0)
- [Fix rendering bug in blog example](https://github.com/jnordberg/wintersmith/pull/335)

## 2.4.0

_2017-05-15_

- [Better error reporting when template requires are missing](https://github.com/jnordberg/wintersmith/commit/5766cb533b503cc91dea03547dc9ce2698204240)
- [Update dependencies](https://github.com/jnordberg/wintersmith/commit/4d1beb7250d44841547cc667c1fe8fbc88e18c5b)
- Switched from `~` to `^` semver versioning for dependencies
- Update for npm 5

## 2.3.6

_2016-12-12_

- [Fix bug causing ignore option to break contents loading](https://github.com/jnordberg/wintersmith/commit/e0c5c5f799feb87e50f6acf4bed8e0ddc0d549a7)

## 2.3.5

_2016-12-11_

- [Depend on jade-legacy instead of deprecated jade module](https://github.com/jnordberg/wintersmith/commit/31ddafaa45306b3b8ac57cd99873c9157c703822)

## 2.3.4

_2016-12-11_

- [Update dependencies](https://github.com/jnordberg/wintersmith/commit/a5087b8abaf3589c0ebf897c9bcde24f8cd7d5d0)
- [Use npms.io for plugin listings instead of npm's built-in search](https://github.com/jnordberg/wintersmith/commit/5641e420e65c92f40e8ad1f2d6ee5acb4bdb1972)
- [Fix hardcoded http protocol in blog template](https://github.com/jnordberg/wintersmith/commit/053c36d5f3055534eaca9dd29b51707db1fe0e2d)

## 2.3.3

_2016-09-15_

- [Fix bug where the render callback could be called before the all the data where written to disk](https://github.com/jnordberg/wintersmith/commit/4e255568fb0a66b680e85d6c1948ba5448197f7c)

## 2.3.2

_2016-06-06_

- [Update dependencies](https://github.com/jnordberg/wintersmith/commit/5634b192d80c18f5d13c012a23c632cc086c2795)

## 2.3.1

_2016-02-29_

- [Fix regression where resolved filenames where no longer emitted with the 'change' event during preview](https://github.com/jnordberg/wintersmith/commit/145875ec1d502d57a6fdefbb8ed9404e53abb5b7)

## 2.3.0

_2016-02-24_

- [Removed individual file change monitoring during preview](https://github.com/jnordberg/wintersmith/commit/1f905cc2b48fe0fffd07dbc14bb7f10dc9b780e7)
- [Add config option to change the list of intro cutoff strings](https://github.com/jnordberg/wintersmith/pull/304)
- [Use laquo and raquo in blog template](https://github.com/jnordberg/wintersmith/pull/302)
- [Fallback to the normalized URI when determining the content type of files in the preview server](https://github.com/jnordberg/wintersmith/pull/303)
- [Update dependencies](https://github.com/jnordberg/wintersmith/commit/0a4489e3299c69a702381684820d1e5176f1867e)

## 2.2.5

_2016-01-02_

- [Added support for custom Highlight.js options](https://github.com/jnordberg/wintersmith/pull/297/files)
- [Fix bug where content nodes parent references where not being updated when trees where merged](https://github.com/jnordberg/wintersmith/pull/296/files) - refs [#295](https://github.com/jnordberg/wintersmith/issues/295)
- [Disable nunjucks autoescaping in webapp example](https://github.com/jnordberg/wintersmith/commit/d75b60c207eaae3ad7e252280fbc5e1a00388b99)
- [Update dependencies](https://github.com/jnordberg/wintersmith/commit/4911c15a5e79d46f020cdea8ad0320894dae45e6)
- Started keeping this changelog
