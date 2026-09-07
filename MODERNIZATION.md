# Wintersmith modernization plan

> **Status: complete.** This is the plan the port from wintersmith 2.5.0 was
> executed against, and the result was released as **coldsmith 3.0.0** —
> continuing wintersmith's version line rather than restarting, which is why
> the "3.0" this document uses throughout ended up being the right number. It
> is kept for the rationale behind the decisions rather than as a live
> document, so it still says "wintersmith" for what is now called coldsmith.
> For what actually changed and how to migrate, see [CHANGES.md](CHANGES.md).
>
> One prediction in here was wrong, and pleasantly so: `examples/webapp` was
> expected to be unsalvageable and slated for deletion. It builds fine on the
> port, third-party plugins and all, so it was kept and promoted into the test
> suite as the plugin-compatibility check.
>
> One open question at the bottom of this document — "Pug's future", deferred
> as not a 3.0 concern — was settled just before release: pug was replaced by
> EJS. The claim made here, that the template plugin interface makes swapping
> the engine a small change, held up. The plugin is the same shape as the pug
> one it replaced and the webapp golden snapshot did not move a byte; the cost
> was all in the example templates, because EJS has no `extends`/`block`.

Convert Wintersmith from CoffeeScript 1.x to modern JavaScript and bring the
dependency set back to life, without orphaning the existing plugin ecosystem.

**Scope:** 2,399 lines of CoffeeScript across 20 files in `src/`, plus 3 example
sites. There is no test suite — none has ever existed in this repo's history.
Last commit: June 2019.

## Decisions

| Decision                   | Choice                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| Module system              | **ESM only**, `"type": "module"`, `engines.node >= 20`                |
| Plugin/view API            | **async/await internally, callback extension points still accepted**  |
| CoffeeScript in user sites | **Dropped.** Examples converted to JS                                 |
| Dependencies               | **Full modernization** — current majors, drop what Node does natively |
| Language                   | **JavaScript. Never TypeScript.** JSDoc types only, if any            |

No TypeScript anywhere: not in source, not in a build step, not as `.d.ts`
authored by hand. If editor types are wanted later, generate them from JSDoc.

---

## Phase 0 — Safety net (do this first)

Without tests, every later phase is a guess. This phase is the highest-value
work in the plan and must land before a single `.coffee` file is deleted.

1. **Golden-output harness.** Script that builds an example site with the
   _current_ CoffeeScript implementation and records `build/` as a manifest of
   `relative path -> sha256`, plus verbatim copies of the HTML files. Snapshot
   goes in `test/fixtures/golden/`.
   - `examples/basic` — trivial, markdown + pug.
   - `examples/blog` — the real target: generators, pagination, JSON pages,
     authors, feed, `filenameTemplate`, static assets, `require` locals
     (`moment`, `underscore`, `typogr`).
   - `examples/webapp` — **cannot be built.** Depends on four abandoned
     plugins (`wintersmith-less`, `-browserify`, `-nunjucks`, `-livereload`).
     See Phase 6.
2. **A purpose-built fixture site** (`test/fixtures/site/`) covering what the
   examples miss: `config.ignore` glob patterns, a custom `views/` directory,
   `view: 'none'`, `template: 'none'`, absolute (`/`-prefixed)
   `filenameTemplate`, `{{ }}` moustache filename eval, nested content
   directories, a content plugin registered by a user plugin, and a page whose
   markdown contains relative links that must resolve through the content tree.
3. **Pin the reference build.** Vendor the current `node_modules` resolution as
   a committed `package-lock.json` snapshot on a `pre-modernization` tag so the
   golden output can be regenerated later if needed.
4. **Test runner:** `node --test` (built in — no mocha, no dep).

Exit criterion: `npm test` builds the fixtures with the CoffeeScript code and
compares byte-for-byte against the golden manifest, and it passes.

---

## Phase 1 — Two compatibility hazards to settle before porting

These are the only places where "modern JS" and "existing plugins keep working"
genuinely conflict. Both need an explicit decision, and both are cheap to get
right up front and expensive to retrofit.

### 1a. Base classes must stay callable without `new`

Every published Wintersmith plugin was compiled from CoffeeScript 1.x, which
implements inheritance with `__extends` and calls the parent constructor as a
plain function:

```js
function MarkdownPage() {
  return Page.apply(this, arguments)
} // CS 1.x output
__extends(MarkdownPage, Page)
```

An ES `class` throws `TypeError: Class constructor cannot be invoked without
'new'` in exactly that situation. So converting `ContentPlugin`, `Page`, and
`TemplatePlugin` into ES classes silently breaks every third-party plugin.

**Recommendation:** keep the three _public base classes_ as function
constructors with prototype methods — roughly 20 lines of deliberately
non-idiomatic code, commented as such. `class X extends ContentPlugin` works
fine against a function constructor, so modern subclasses are unaffected and
both worlds coexist. Everything else in the codebase (`Config`, `ContentTree`,
`MarkdownPage`, `PugTemplate`, the CLI internals) becomes a real `class`.

Add a test that constructs a subclass via the CS 1.x `__extends` pattern and
asserts it still works.

### 1b. `ContentTree` enumerability is load-bearing

`ContentTree` is deliberately _not_ a CoffeeScript class ("we need a clean
prototype"). `filename`, `parent`, `index`, `_`, and `__groupNames` are all
installed with `Object.defineProperty` and therefore non-enumerable, so
`for key of tree` yields **only content items**. `ContentTree.flatten`,
`.merge`, `.inspect`, the generator resolver, and every user template that
iterates `contents` depend on this.

**Modern equivalent:** an ES class using `#private` fields for the closure
state (`#groups`, `#parent`, `#filename`) plus prototype getters. Private
fields are invisible to `for...in` and prototype accessors are non-enumerable,
so the semantics are preserved exactly. `parent` needs a setter (`merge` and
the directory walk both assign it). What must **not** be used: public class
fields — those are enumerable own properties and would appear as phantom
entries in every content tree.

Test: build a tree, assert `Object.keys(tree)` contains only content names.

---

## Phase 2 — Async model

Drop `async` (the library) entirely and rewrite the core in async/await.

**Mapping:**

| Current                                             | Replacement                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `async.waterfall`                                   | sequential `await`                                                 |
| `async.parallel` / `async.map`                      | `Promise.all`                                                      |
| `async.series` / `mapSeries`                        | `for...of` with `await`                                            |
| `async.forEachLimit(items, config._fileLimit, ...)` | small `mapLimit(items, limit, fn)` helper in `utils`               |
| `async.until(isReady, sleep)`                       | `while (!isReady()) await setTimeout(50)` (`node:timers/promises`) |
| `async.apply`                                       | arrow function                                                     |

`config._fileLimit` (default 40) exists to cap open file descriptors during
tree scanning and rendering. It must survive the rewrite — the `mapLimit`
helper is not optional sugar.

**Dual-signature shim for extension points.** One helper, used at every place
where user code is invoked:

```js
// utils.js — call a user-supplied function that may be callback-style or
// may return a promise, and always get a promise back.
export function callUser(fn, thisArg, args, { callbackArity }) { ... }
```

Applies to: plugin modules `(env, callback)`, views
`(env, locals, contents, templates, callback)`, `Plugin.fromFile(filepath, cb)`,
`Template#render(locals, cb)`, and generator functions `(contents, callback)`.
Detection is by declared arity, with the callback always passed so that
callback-style code works unchanged; if the function also returns a thenable,
that wins and the callback is ignored.

Public API surface (`Environment#build`, `#preview`, `#load`, `#getContents`,
`#getTemplates`, `Config.fromFile`, `ContentPlugin.fromFile`) returns promises
but still honours a trailing callback, so embedders keep working. This is
`3.0.0` regardless — say so in the changelog.

---

## Phase 3 — Dependency replacement

From 19 runtime dependencies to roughly 8.

**Removed, replaced by Node built-ins:**

| Dep                           | Replacement                                    |
| ----------------------------- | ---------------------------------------------- |
| `async`                       | native promises + `mapLimit` helper            |
| `mkdirp`                      | `fs.mkdir(dir, { recursive: true })`           |
| `rimraf`                      | `fs.rm(dir, { recursive: true, force: true })` |
| `ncp`                         | `fs.cp(src, dest, { recursive: true })`        |
| `server-destroy`              | `server.closeAllConnections()` (Node 18.2+)    |
| `npm` (a ~50 MB runtime dep!) | `spawn('npm', ['install'], { cwd, stdio })`    |
| `winston` + custom Transport  | ~50-line logger module                         |
| `coffee-script`               | gone                                           |
| `minimist`                    | `node:util` `parseArgs` — see caveat below     |

**Upgraded, with API changes to handle:**

- **`marked` 0.5 → 16.** The `InlineLexer.prototype.outputLink` monkeypatch
  (`src/plugins/markdown.coffee:10-16`) no longer exists. Link resolution moves
  to `marked.use({ renderer: { link(token) {...}, image(token) {...} } })`,
  with the content node captured per-parse. `marked(md)` → `marked.parse(md)`.
  The `highlight` option was removed → use `marked-highlight`.
  **Config break:** `smartLists` and `smartypants` (both used by the blog
  example's `config.json`) were removed from marked — drop them or pull in
  `marked-smartypants`. Note this in `CHANGES.md`; user configs will carry
  these keys.
- **`highlight.js` 9 → 11.** `hljs.highlight(lang, code)` →
  `hljs.highlight(code, { language })`. `classPrefix: ''` still supported.
- **`js-yaml` 3 → 4.** `load()` is now safe-by-default (old `safeLoad`). The
  front-matter error pretty-printer reads `error.problem` / `error.problemMark`
  — in v4 that's `error.reason` / `error.mark` (`.buffer`, `.line`, `.column`).
- **`chalk` 2 → 5** (ESM-only, same API). Alternative: `picocolors`, ~10× smaller,
  drop-in for the handful of colors used. Either is fine; chalk keeps
  `chalk[pluginColor]` dynamic lookup working for `getPluginColor()`.
- **`chokidar` 2 → 4.** Drops the `fsevents` native binding. Glob support was
  removed in v4 but is not used — only directories are watched.
- **`mime` 2 → 4** (ESM). `mime.getType()` unchanged.
- **`pug` 2 → 3.** `pug.compile` unchanged. (Pug is in maintenance mode; it
  stays as the default template plugin, but nothing in core depends on it —
  it's a registered plugin like any other.)
- **`slugg`** — keep, it's 20 lines and stable.

**`parseArgs` caveats.** `node:util`'s `parseArgs` is not a drop-in for
minimist. Two things break: `-vv` (checked literally in
`src/cli/index.coffee:661`) is not a valid short-option group with values, and
minimist's positional/alias/default behaviour differs. Handle `-vv` by
scanning `process.argv` before parsing. If it turns fiddly, keeping `minimist`
(1.2.8, no known advisories) is an acceptable outcome — this is the
lowest-value swap in the list.

**Dead service.** `wintersmith plugin list` queries `api.npms.io`, which has
been shut down. Replace with the official registry search endpoint:
`https://registry.npmjs.org/-/v1/search?text=keywords:wintersmith-plugin&size=250`
(response shape is `{ objects: [{ package: {...} }] }` rather than
`{ results: [...] }`). Verify the endpoint at implementation time.

---

## Phase 4 — File-by-file conversion

Convert leaves first so each step can be validated against the golden output
with the rest of the tree still on CoffeeScript. Run
`node bin/dev/cli` (CoffeeScript, via register) against the same fixtures in
parallel during the transition.

| #   | File               | Lines | Notes                                                                                                                                                                                                  |
| --- | ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `core/utils`       | 98    | Add `mapLimit`, `callUser`. `fileExists` off deprecated `fs.exists` → `fs.access`. `rfc822` unchanged. `pump` → `stream/promises` `pipeline`                                                           |
| 2   | `core/logger`      | 51    | Replace winston entirely. Keep `logger.transports[0].level/.quiet` shape or update the 3 CLI call sites                                                                                                |
| 3   | `core/config`      | 69    | Straightforward. `Config.defaults` static                                                                                                                                                              |
| 4   | `core/content`     | 294   | **Highest risk.** `ContentTree` (Phase 1b), `ContentPlugin` (Phase 1a), `inspect` → `util.inspect.custom`                                                                                              |
| 5   | `core/templates`   | 58    | `loadTemplate` currently assigns the template even when `fromFile` errored — fix                                                                                                                       |
| 6   | `core/generator`   | 38    | Trivial                                                                                                                                                                                                |
| 7   | `core/renderer`    | 66    | `mkdirp.sync` → `fs.mkdir` recursive; keep `_fileLimit`                                                                                                                                                |
| 8   | `core/environment` | 312   | `loadModule` → dynamic `import()`; drop coffee register; `resolveModule` via `import.meta.resolve` / `createRequire`. Module cache invalidation for `reset()` is **not possible with ESM** — see below |
| 9   | `core/server`      | 334   | Preview server + watchers; drop `server-destroy`                                                                                                                                                       |
| 10  | `plugins/page`     | 158   | `@property` helper; `vm` moustache eval stays                                                                                                                                                          |
| 11  | `plugins/markdown` | 162   | marked rewrite (Phase 3)                                                                                                                                                                               |
| 12  | `plugins/pug`      | 33    | Trivial                                                                                                                                                                                                |
| 13  | `cli/common`       | 155   | Delete `NpmAdapter` and the Node-0.8 `stream.Writable` shim                                                                                                                                            |
| 14  | `cli/index`        | 76    | Command dispatch → explicit map, not dynamic `require` on user input                                                                                                                                   |
| 15  | `cli/build`        | 84    | `rimraf` → `fs.rm`                                                                                                                                                                                     |
| 16  | `cli/preview`      | 53    | Trivial                                                                                                                                                                                                |
| 17  | `cli/new`          | 102   | npm API → `spawn`                                                                                                                                                                                      |
| 18  | `cli/plugin`       | 194   | npm API → `spawn`; registry endpoint fix                                                                                                                                                               |
| 19  | `cli/version`      | 4     | No longer generated at build time — read `package.json` via `readFile(new URL('../package.json', import.meta.url))`                                                                                    |
| 20  | `index`            | 9     | Named exports                                                                                                                                                                                          |

**Method:** hand-port with the CoffeeScript open alongside. Do **not** run the
output of `decaffeinate` or `coffee -c` into the tree — the async/await rewrite
is happening simultaneously and the generated code fights it. Compiling a
single tricky expression with `coffee -c -p` to check semantics is fine.

### The port runs on a hybrid tree

`"type": "module"` was set at the _start_ of the port rather than the end,
because it makes the tree incrementally portable:

- Node resolves `require('./utils')` to `utils.js` before `utils.coffee`, and
  Node 22's `require(esm)` lets the remaining CoffeeScript destructure named
  exports out of a ported ESM module.
- So each file can be ported, its `.coffee` original deleted, and the **golden
  tests run immediately** against a part-CoffeeScript, part-JavaScript tree.

This gives per-file end-to-end verification instead of one unverifiable
big-bang at the end. The cost: a ported module must keep a callback signature
for as long as any CoffeeScript caller remains, which the dual-signature helper
(`dual()` in `utils.js`) makes cheap — and which the public API needs anyway.

Two things this turned up:

- Extensionless entry points (`bin/dev/cli`) _do_ follow the nearest
  `package.json` `"type"`, so the CoffeeScript dev entry was renamed to
  `bin/dev/cli.cjs`.
- Files inside `test/fixtures/site/` needed their own `package.json` declaring
  `"type": "commonjs"`, which is realistic — a wintersmith site is its own
  package, and its plugins are CommonJS.

### ESM module reloading — a real constraint

`Environment#reset()` clears `require.cache` to unload user plugins and views,
and the preview server relies on this to pick up view edits without a restart
(`src/core/server.coffee:1003`). **ESM has no cache-eviction API.** Options:

1. Cache-bust with a query string: `import(url + '?v=' + counter)`. Works,
   leaks the old module (fine for a dev server), and is the standard workaround.
2. Restart the preview server process on view changes (simplest, slower).
3. `module.register()` loader hook (over-engineered here).

**Recommendation:** option 1, with the counter bumped per reload. Note that
CommonJS user plugins loaded through `import()` land in the _CJS_ cache, which
`createRequire(...).cache` can still evict — so keep that path too.

### CoffeeScript idioms that translate wrongly

Add these to the review checklist for every file:

- Implicit returns. CoffeeScript returns the last expression of every function;
  several functions here rely on it (`getUrl`, `getView`, `resolveLink`). Some
  deliberately return nothing via a bare `return` (`extend`, `setupLocals`).
- `for i in [arr.length - 1..0] by -1` — when `arr` is empty this iterates
  `-1` then `0` and dereferences `arr[-1]`. Latent crash in `loadContent`
  (`content.coffee:191`) and `loadTemplate` (`templates.coffee:1220`) if no
  plugins are registered. Use a plain reverse loop that no-ops on empty.
- `alias = module.replace(/\/$/, '').split('/')[-1..]` in `cli/common.coffee:531`
  is a **slice, returning an array**, not a string. It works by accident
  (arrays stringify when used as an object key). Fix to `.at(-1)`.
- `(' ' for [0...n]).join('')` → `' '.repeat(n)`.
- `a ? b` → `a ?? b`; `a ?= b` → `a ??= b`; `a?.b` → `a?.b`; soaked
  _assignment_ `instance?.__env = env` has no JS equivalent — needs an `if`.
- `key in array` → `array.includes(key)`; `for k, v of obj` →
  `Object.entries(obj)` (watch prototype-chain walks: `for...of` on an object
  in CoffeeScript is `for...in` in JS and **does** walk the prototype — this is
  exactly what `ContentPlugin.property`'s `enumerable: true` accessors rely on).
- `super(base)` in `Page#getUrl`.
- Class bodies whose methods reference `@`-bound constructor params
  (`constructor: (@filepath, @metadata) ->`) → explicit assignment.

---

## Phase 5 — Packaging & repo hygiene

- Delete `bin/dev/`, `bin/dev/compile_coffee`, and the `prepublishOnly` script.
  **No build step.** `src/` is what ships.
- `package.json`: `"type": "module"`, `"exports"` map replacing `"main"`,
  `"files": ["src", "bin", "examples"]`, `engines.node: ">=20"`. Drop
  `directories.lib`. Fix the `engine` typo (it's `engines`).
- `bin/wintersmith` → `import('../src/cli/index.js')`.
- `.gitignore`/`.npmignore`: remove `lib`.
- ESLint 9 flat config + Prettier. No TypeScript-aware plugins.
- GitHub Actions: `node-version: [20, 22, 24]` on ubuntu + windows (there is
  Windows-specific path handling in `getUrl` and `getStorageDir` that has
  clearly never been CI-tested).
- `CHANGES.md` entry for 3.0.0 documenting: Node 20+, ESM, no CoffeeScript in
  user sites, marked config keys removed, callback API deprecated-but-working.
- README: update the install/quick-start, drop the dead IRC/freenode line, note
  that wintersmith.io and the wiki links may be dead (verify).

---

## Phase 6 — Examples

- `examples/basic` — pug + markdown, no changes beyond config.
- `examples/blog` — convert `plugins/paginator.coffee` → `paginator.js` (it is
  the reference plugin for the whole ecosystem, so it should read as exemplary
  modern JS: a real `class` extending `env.plugins.Page`, async generator
  function). Update `config.json` for the removed marked options. Bump
  `moment`/`underscore`/`typogr` or replace `moment` with `Intl.DateTimeFormat`.
- `examples/webapp` — **currently unbuildable.** All four of its plugins are
  abandoned and its content is `.less` + `.coffee`. Two options: delete it, or
  rewrite as an esbuild-based example with a small in-repo plugin. Recommend
  deleting it in 3.0 and adding a leaner example later if wanted — a broken
  template that `wintersmith new -T webapp` happily scaffolds is worse than no
  template.

---

## Open questions (not blocking, decide before publishing)

1. **Publishing identity.** `package.json` still points at
   `jnordberg/wintersmith`, but recent commits merge from `uvcrew`. Publishing
   as `wintersmith@3.0.0` needs ownership of the npm name; otherwise a scoped
   name and a rename pass across README/CLI output.
2. **Plugin ecosystem triage.** Which third-party plugins are worth verifying
   against 3.0? Suggest testing the top 5 by download and listing results in
   the README.
3. **Pug's future.** It works but is in maintenance. Not a 3.0 concern; worth a
   note that the template plugin interface makes replacing it a config change.

---

## Sequencing

```
Phase 0  golden harness + fixtures         ← must land first
Phase 1  base-class + ContentTree spikes   ← settle the two hazards
Phase 2  async helpers in utils
Phase 3  dependency swaps (interleaved with Phase 4 per file)
Phase 4  file-by-file port, leaves → root, golden diff after each
Phase 5  packaging
Phase 6  examples
```

The golden-output diff after every file in Phase 4 is what makes this
tractable: any change in rendered bytes is either an intentional, documented
break (marked's HTML output _will_ differ across 16 majors — expect to
re-baseline once, deliberately, at step 11) or a porting bug.
