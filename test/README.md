# Tests

Run everything:

```bash
npm test
```

## Golden-output tests

`golden.test.mjs` builds each site in `support/sites.mjs` and compares the
result, byte for byte, against a snapshot committed under `golden/`. This is
the safety net for the CoffeeScript-to-JavaScript port: the implementation
underneath changes completely, the rendered bytes must not.

A snapshot is a `manifest.json` of every output file with its sha256, verbatim
copies of the text output under `files/` so failures produce a readable diff,
and `stdout.txt` — which incidentally covers `ContentTree.inspect()`, plugin
colours, and URL generation.

The tests find the CLI themselves, in this order:

1. `$WINTERSMITH_CLI`, for diffing two implementations by hand
2. `bin/wintersmith`, once `src/cli/index.js` exists
3. `bin/dev/cli`, the CoffeeScript entry point

So the same tests run against both implementations with no edits.

Builds are run with `TZ=UTC` because `rfc822date()` formats in local time. The
current year is normalized to `{{BUILD_YEAR}}` because the blog example renders
a copyright line with `new Date().getFullYear()`.

### Re-baselining

```bash
npm run test:update
```

Do this only when output has changed **on purpose**, and read the `git diff`
before committing. Two upgrades in the port are expected to change output and
will need a deliberate re-baseline:

- **marked 0.5 → 16** — different HTML for the same markdown
- **highlight.js 9 → 11** — different token class names

Anything else that shows up in that diff is a porting bug.

## Fixtures

`fixtures/site/` is a purpose-built site covering what the examples miss:

| Covered | Where |
| --- | --- |
| YAML front matter and ```metadata blocks | `contents/index.md`, `winter-matter.md` |
| Quoted vs. unquoted YAML dates | `contents/index.md`, `yaml-date.md` |
| Link resolution: sibling, nested, anchor, absolute, external, unresolvable, image | `contents/index.md` |
| Link resolution walking back up the tree | `contents/pages/deep/note.md` |
| `filenameTemplate`: `:year`/`:month`/`:day`, `:title` slugification, absolute paths, `{{ }}` eval | `contents/dated.md`, `slug-me.md`, `moustache.md` |
| `view: none` and a custom view from `views/` | `contents/no-view.md`, `custom-view.md` |
| Ignore globs: extension, directory, nested pattern | `config.json`, `ignored.tmp`, `secret/`, `note.draft.md` |
| A JSON page | `contents/data.json` |
| A user plugin registering a content plugin, a generator, and a helper | `plugins/shout.js` |
| Modules loaded through `require` — builtin and site-relative | `config.json`, `lib/helpers.js` |
| Content groups and tree enumerability | `templates/list.pug` |
| `page.intro` / `page.hasMore` cutoffs | `templates/page.pug` |
| Syntax highlighting | `contents/index.md` |

`plugins/shout.js` is deliberately CommonJS with callback signatures, because
that is the shape of every published wintersmith plugin. If a port breaks it,
it breaks the ecosystem.

The `examples/blog` golden test is skipped unless its dependencies are
installed (`cd examples/blog && npm install`).
