# Blog

The default [coldsmith](https://github.com/binarymax/coldsmith) template.
This is what `coldsmith new <path>` scaffolds unless you pass `-T`.

Run `npm install` to install the template's dependencies, then
`coldsmith preview` to start the local server.

## What it demonstrates

- `plugins/paginator.js` — the reference plugin. It registers a generator,
  subclasses the `Page` content plugin, and adds a helper to the environment.
- Content groups, via `contents._.paginator` and `contents.articles`.
- A JSON page (`contents/archive.json`) and an RSS feed built from an EJS
  template rather than a special-cased feed generator.
- Template context modules, through the `require` key in `config.json`.
- A layout built from EJS partials. `_head.ejs` and `_foot.ejs` are the two
  halves of the page shell; anything a page needs to vary — the title, the
  body class, the header, the footer nav — is passed in as a local. Partials
  are prefixed with an underscore by convention only; coldsmith loads every
  `.ejs` file in the directory as a template.

## Note on dependencies

The templates use three modules pulled in through `config.json`'s `require`
key. Two of them are no longer maintained:

- **moment** is in maintenance mode; its own authors recommend against it for
  new projects. `Intl.DateTimeFormat` covers what the templates use it for.
- **typogr** has not been released since 2016.
- **underscore** is still maintained.

They are kept because replacing them changes the rendered output of a template
people's sites are built from. Replacing them is a good follow-up.
