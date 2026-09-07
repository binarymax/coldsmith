# Tests

Run everything:

```bash
npm test
```

## Golden-output tests

`golden.test.mjs` builds each site in `support/sites.mjs` and compares the
result, byte for byte, against a snapshot committed under `golden/`. This is
the safety net for the CoffeeScript-to-JavaScript port that produced coldsmith: the implementation
underneath changes completely, the rendered bytes must not.

A snapshot is a `manifest.json` of every output file with its sha256, verbatim
copies of the text output under `files/` so failures produce a readable diff,
and `stdout.txt` — which incidentally covers `ContentTree.inspect()`, plugin
colours, and URL generation.

The tests locate the CLI themselves: `$COLDSMITH_CLI` if set, otherwise
`bin/coldsmith`. During the port this let the same tests run unchanged
against both the CoffeeScript and the JavaScript implementation, which is how
each ported file was verified before the next one was started.

Builds are run with `TZ=UTC` because `rfc822date()` formats in local time. The
current year is normalized to `{{BUILD_YEAR}}` because the blog example renders
a copyright line with `new Date().getFullYear()`.

### Re-baselining

```bash
npm run test:update
```

Do this only when output has changed **on purpose**, and read the `git diff`
before committing.

The snapshots were re-baselined exactly once during the port, for the
marked 0.5 → 18 and highlight.js 9 → 11 upgrades — different block whitespace,
different token class names. Any other change in that diff is a bug.

## Fixtures

`fixtures/site/` is a purpose-built site covering what the examples miss:

| Covered                                                                                           | Where                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| YAML front matter and ```metadata blocks                                                          | `contents/index.md`, `winter-matter.md`                  |
| Quoted vs. unquoted YAML dates                                                                    | `contents/index.md`, `yaml-date.md`                      |
| Link resolution: sibling, nested, anchor, absolute, external, unresolvable, image                 | `contents/index.md`                                      |
| Link resolution walking back up the tree                                                          | `contents/pages/deep/note.md`                            |
| `filenameTemplate`: `:year`/`:month`/`:day`, `:title` slugification, absolute paths, `{{ }}` eval | `contents/dated.md`, `slug-me.md`, `moustache.md`        |
| `view: none` and a custom view from `views/`                                                      | `contents/no-view.md`, `custom-view.md`                  |
| Ignore globs: extension, directory, nested pattern                                                | `config.json`, `ignored.tmp`, `secret/`, `note.draft.md` |
| A JSON page                                                                                       | `contents/data.json`                                     |
| A user plugin registering a content plugin, a generator, and a helper                             | `plugins/shout.js`                                       |
| Modules loaded through `require` — builtin and site-relative                                      | `config.json`, `lib/helpers.js`                          |
| Content groups and tree enumerability                                                             | `templates/list.pug`                                     |
| `page.intro` / `page.hasMore` cutoffs                                                             | `templates/page.pug`                                     |
| Syntax highlighting                                                                               | `contents/index.md`                                      |

`plugins/shout.js` is deliberately CommonJS with callback signatures, because
that is the shape of every published wintersmith plugin, and coldsmith keeps
that API. If a change breaks this, it breaks the ecosystem.

## Sites under test

| Site              | Covers                                          |
| ----------------- | ----------------------------------------------- |
| `fixtures/site`   | the matrix above                                |
| `examples/basic`  | the minimum viable site                         |
| `examples/blog`   | generators, pagination, feeds, template context |
| `examples/webapp` | **third-party plugin compatibility**            |

The `blog` and `webapp` tests skip unless their dependencies are installed
(`npm install` in the respective directory).

`examples/webapp` is the ecosystem regression test. It is built entirely by
plugins nobody has touched since 2016 — `wintersmith-less`,
`wintersmith-browserify`, `wintersmith-nunjucks` and `wintersmith-livereload`
— all compiled from CoffeeScript 1.x against the wintersmith 2 API. If a change
breaks plugin compatibility, this is where it surfaces. It is deliberately kept
out of CI, because it installs 400-odd packages from unmaintained projects; run
it locally when touching the plugin API, the base classes, or the extension
point calling convention.
