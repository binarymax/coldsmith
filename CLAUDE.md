# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Coldsmith is a static site generator: a hard fork of [wintersmith](https://github.com/jnordberg/wintersmith),
which was abandoned in 2019. Version 1.0.0 is wintersmith 2.5.0's CoffeeScript
ported to modern ESM JavaScript. `MODERNIZATION.md` is the plan that port ran
against and explains most of the "why" questions; it still says "wintersmith"
throughout because that is what the project was called while the work was done.

**Never TypeScript.** Not in source, not as a build step, not as hand-authored
`.d.ts`. JSDoc only. This is a standing constraint from the project owner.

**There is no build step.** `src/` is what ships and what runs.

## Commands

```bash
npm test                  # unit + preview-server + golden-output tests
npm run lint              # eslint
npm run format            # prettier --write
npm run format:check      # what CI runs
npm run test:update       # RE-BASELINE golden snapshots - see below

node --test test/utils.test.mjs                          # one file
node --test --test-name-pattern="mapLimit" test/*.test.mjs  # one test

node bin/coldsmith build -C <site> -o <out> --clean       # run the CLI
node bin/coldsmith preview -C <site>
```

`examples/blog` and `examples/webapp` have their own dependencies; their golden
tests skip until you `npm install` inside each.

## Architecture

The pipeline, roughly `src/core/environment.js` outward:

```
Config ──► Environment ──► ContentTree ──► generators ──► views ──► templates ──► output
```

- **`Environment`** owns config, the plugin registries (`contentPlugins`,
  `templatePlugins`, `generators`, `views`, `helpers`) and the module loader.
  Everything else hangs off it. `env.build()` and `env.preview()` are the two
  entry points.
- **`ContentTree`** (`core/content.js`) is a nested object mapping filenames to
  `ContentPlugin` instances. It is passed whole to every view and template.
- **Content plugins** claim files by glob (`registerContentPlugin(group, pattern, class)`),
  are built by a `fromFile` factory, and expose `getFilename()` and `getView()`.
- **Views** turn a content instance into a Buffer/Stream, or `null` to skip it.
- **Generators** produce extra content that is merged into the tree.
- **`core/renderer.js`** walks the flattened tree and writes whatever the views
  return.

`core/server.js` is a **separate path** from `build`, not a wrapper around it:
it keeps the tree in memory, watches for changes with chokidar, and re-runs
generators on _every request_. Changing generator or view semantics means
checking both paths.

`src/plugins/{page,pug,markdown}.js` are ordinary plugins, listed in
`Environment.defaultPlugins`. They have no privileged access — a third-party
plugin can do everything they do.

## Invariants that will bite you

These exist for reasons that are not visible from the file you are editing.
`test/content.test.mjs` enforces the first two.

**1. `ContentPlugin`, `StaticFile`, `TemplatePlugin` and `Page` are function
constructors, and must stay that way.** Every plugin published for wintersmith
was compiled by CoffeeScript 1.x, whose inheritance helper calls the parent
constructor as a plain function (`Page.apply(this, arguments)`). An ES class
throws `TypeError: Class constructor cannot be invoked without 'new'` there.
Converting these to `class` silently breaks the entire third-party ecosystem.
Concrete subclasses (`MarkdownPage`, `PugTemplate`, …) are normal ES classes.

**2. `ContentTree` must never use public class fields.** Its internals
(`_`, `filename`, `parent`, `index`, `__groupNames`) are private fields behind
prototype getters specifically so that `for (const key in tree)` yields _only_
content. Public fields are enumerable own properties and would appear as
phantom entries in every tree, breaking `flatten`, `merge`, and user templates.

**3. Every extension point is dual-signature.** User code may be callback-style
(wintersmith 2) or return a promise. Always invoke it through `callUser()` from
`core/utils.js`, never by calling it directly. Public API methods return a
promise _and_ accept a trailing callback, via `dual()`. This is what keeps
`wintersmith-*` plugins working.

**4. `mapLimit()` is not sugar for `Promise.all`.** `config._fileLimit`
(default 40) caps simultaneously open file descriptors during tree scanning and
rendering. Unbounded concurrency blows past it on a large site.

**5. ESM has no cache eviction.** `Environment#loadModule` versions the import
specifier with a query string so the preview server can pick up edited views,
and unwraps `namespace.default` so CommonJS plugins load unchanged.
`invalidateModules()` is the reload hook.

## The golden-output tests

`test/golden.test.mjs` builds four sites and compares the result **byte for
byte** against snapshots committed in `test/golden/`. This is the safety net
that made the CoffeeScript port verifiable, and it is the main regression test
for anything touching rendering.

- `test/fixtures/site` — purpose-built, covers the feature matrix in
  `test/README.md`
- `examples/basic`, `examples/blog` — normal sites
- `examples/webapp` — the **plugin-compatibility test**. Built entirely by
  third-party plugins untouched since 2016 and compiled from CoffeeScript 1.x.
  Run it locally after touching the plugin API, the base classes, or the
  extension-point calling convention. Excluded from CI (400-odd deprecated
  packages).

Consequences worth internalising:

- **Editing anything under `examples/*/contents/` or `test/fixtures/*/contents/`
  changes rendered output** and fails the golden tests. That is why those paths
  are in `.prettierignore` — never remove them, or a `npm run format` will
  silently invalidate the snapshots.
- Builds are pinned to `TZ=UTC` because `rfc822()` formats in local time, and
  the current year is normalized because the blog layout renders a copyright
  line from `new Date()`.
- Golden tests skip on Windows: content filenames are built with `path.join`
  and carry backslashes into output, so the comparison would only measure the
  separator.
- Re-baseline with `npm run test:update` **only** when output changed on
  purpose, and read the resulting `git diff`. It has been re-baselined twice
  ever: once for the marked/highlight.js upgrades, once for the coldsmith
  rebrand.

## Compatibility with wintersmith

Preserving the wintersmith plugin ecosystem is most of the point of the fork,
so several things intentionally still say "wintersmith":

- `coldsmith plugin list` searches npm for both the `coldsmith-plugin` and
  `wintersmith-plugin` keywords; `normalizePluginName` strips either prefix.
- `WINTERSMITH_PATH` is still honoured alongside `COLDSMITH_PATH`.
- Comments describing what _wintersmith 2_ did are accurate history explaining
  why code is shaped the way it is. Leave them.

`CHANGES.md` documents every breaking change relative to wintersmith 2.5.0 and
is the reference for migration questions.
