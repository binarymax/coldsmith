# Blog

The default [wintersmith](https://github.com/jnordberg/wintersmith) template.
This is what `wintersmith new <path>` scaffolds unless you pass `-T`.

Run `npm install` to install the template's dependencies, then
`wintersmith preview` to start the local server.

## What it demonstrates

- `plugins/paginator.js` — the reference plugin. It registers a generator,
  subclasses the `Page` content plugin, and adds a helper to the environment.
- Content groups, via `contents._.paginator` and `contents.articles`.
- A JSON page (`contents/archive.json`) and an RSS feed built from a pug
  template rather than a special-cased feed generator.
- Template context modules, through the `require` key in `config.json`.

## Note on dependencies

The templates use three modules pulled in through `config.json`'s `require`
key. Two of them are no longer maintained:

- **moment** is in maintenance mode; its own authors recommend against it for
  new projects. `Intl.DateTimeFormat` covers what the templates use it for.
- **typogr** has not been released since 2016.
- **underscore** is still maintained.

They are kept because replacing them changes the rendered output of a template
people's sites are built from. Replacing them is a good follow-up.
