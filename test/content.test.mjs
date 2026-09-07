import assert from 'node:assert/strict'
import test from 'node:test'
import util from 'node:util'

import { ContentPlugin, ContentTree, StaticFile } from '../src/core/content.js'

/**
 * The inheritance helper CoffeeScript 1.x emitted, copied verbatim.
 *
 * Every wintersmith plugin published before 3.0 was compiled with this, so it
 * is the compatibility contract for the base classes. The critical line is
 * `child.__super__ = parent.prototype` combined with constructors that call
 * `Parent.apply(this, arguments)` - an ES class throws there.
 */
const hasProp = {}.hasOwnProperty
function __extends(child, parent) {
  for (const key in parent) {
    if (hasProp.call(parent, key)) child[key] = parent[key]
  }
  function ctor() {
    this.constructor = child
  }
  ctor.prototype = parent.prototype
  child.prototype = new ctor()
  child.__super__ = parent.prototype
  return child
}

test('CoffeeScript 1.x subclasses of ContentPlugin still work', () => {
  // This is what `class LegacyPage extends ContentPlugin` compiled to in 2019.
  function LegacyPage(filepath) {
    LegacyPage.__super__.constructor.apply(this, arguments)
    this.filepath = filepath
  }
  __extends(LegacyPage, ContentPlugin)

  LegacyPage.prototype.getFilename = function () {
    return this.filepath.relative
  }

  const page = new LegacyPage({ relative: 'a/b.md' })
  page.__env = { config: { baseUrl: '/' } }

  assert.ok(page instanceof ContentPlugin)
  assert.equal(page.filename, 'a/b.md')
  assert.equal(page.url, '/a/b.md')
  assert.equal(page.pluginColor, 'cyan')
})

test('CoffeeScript 1.x subclasses inherit the property() static', () => {
  function LegacyPage() {
    LegacyPage.__super__.constructor.apply(this, arguments)
  }
  __extends(LegacyPage, ContentPlugin)

  // __extends copies own statics, so plugins call @property in their bodies.
  assert.equal(typeof LegacyPage.property, 'function')
  LegacyPage.property('shouted', function () {
    return 'LOUD'
  })
  assert.equal(new LegacyPage().shouted, 'LOUD')
})

test('CoffeeScript 1.x subclasses of StaticFile still work', () => {
  function LegacyStatic() {
    LegacyStatic.__super__.constructor.apply(this, arguments)
  }
  __extends(LegacyStatic, StaticFile)

  const instance = new LegacyStatic({ full: '/tmp/x', relative: 'x' })
  assert.ok(instance instanceof StaticFile)
  assert.ok(instance instanceof ContentPlugin)
  assert.equal(instance.filename, 'x')
  assert.equal(instance.pluginColor, 'none')
})

test('modern ES class subclasses work too', () => {
  class ModernPage extends ContentPlugin {
    constructor(filepath) {
      super()
      this.filepath = filepath
    }
    getFilename() {
      return this.filepath.relative
    }
  }
  const page = new ModernPage({ relative: 'a/b.md' })
  page.__env = { config: { baseUrl: '/blog' } }
  assert.ok(page instanceof ContentPlugin)
  // baseUrl without a trailing slash still resolves as a directory.
  assert.equal(page.url, '/blog/a/b.md')
})

test('ContentPlugin properties are enumerable, as templates expect', () => {
  class ModernPage extends ContentPlugin {
    getFilename() {
      return 'x.html'
    }
  }
  const page = new ModernPage()
  page.__env = { config: { baseUrl: '/' } }
  const keys = []
  for (const key in page) keys.push(key)
  assert.ok(keys.includes('url'), 'url must show up in a for-in over content')
  assert.ok(keys.includes('filename'))
})

test('base classes reject being used without new, but only from the outside', () => {
  // Sanity check that these really are function constructors: an ES class
  // would throw here, and that throw is what breaks legacy plugins.
  assert.doesNotThrow(() =>
    ContentPlugin.call(Object.create(ContentPlugin.prototype)),
  )
})

/* ------------------------------------------------------------------ */

function fakePlugin(name, group = 'pages') {
  class Fake extends ContentPlugin {
    getFilename() {
      return name
    }
  }
  const instance = new Fake()
  instance.__plugin = { group }
  instance.__env = { config: { baseUrl: '/' } }
  return instance
}

test('ContentTree exposes only content to enumeration', () => {
  const tree = new ContentTree('', ['pages'])
  tree['index.md'] = fakePlugin('index.html')
  tree['other.md'] = fakePlugin('other.html')

  assert.deepEqual(Object.keys(tree).sort(), ['index.md', 'other.md'])

  const seen = []
  for (const key in tree) seen.push(key)
  assert.deepEqual(seen.sort(), ['index.md', 'other.md'])

  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(tree))).sort(), [
    'index.md',
    'other.md',
  ])
})

test('ContentTree internals are readable but never enumerable', () => {
  const tree = new ContentTree('somedir', ['pages'])
  assert.equal(tree.filename, 'somedir')
  assert.deepEqual(tree.__groupNames, ['pages'])
  assert.deepEqual(Object.keys(tree._).sort(), ['directories', 'files', 'pages'])
  assert.equal(tree.parent, null)

  const parent = new ContentTree('', [])
  tree.parent = parent
  assert.equal(tree.parent, parent)

  assert.equal(Object.keys(tree).length, 0, 'no internals leaked as own keys')
})

test('ContentTree.index finds the index entry', () => {
  const tree = new ContentTree('', ['pages'])
  assert.equal(tree.index, undefined)
  const index = fakePlugin('index.html')
  tree['index.md'] = index
  tree['zzz.md'] = fakePlugin('zzz.html')
  assert.equal(tree.index, index)
})

test('ContentTree rejects reserved names instead of dropping content', () => {
  const root = new ContentTree('', ['pages'])
  // A generator can hand merge a plain object, which is the only way a
  // reserved key reaches it - assigning `_` onto a ContentTree throws at the
  // assignment, since `_` is a getter.
  assert.throws(
    () => ContentTree.merge(root, { _: fakePlugin('underscore.html') }),
    /reserved name/,
  )
  assert.throws(() => {
    const tree = new ContentTree('', [])
    tree['_'] = fakePlugin('x.html')
  }, /only a getter/)
})

test('ContentTree.flatten walks nested trees', () => {
  const root = new ContentTree('', ['pages'])
  const sub = new ContentTree('sub', ['pages'])
  root['a.md'] = fakePlugin('a.html')
  root.sub = sub
  sub['b.md'] = fakePlugin('b.html')
  assert.deepEqual(
    ContentTree.flatten(root)
      .map((item) => item.filename)
      .sort(),
    ['a.html', 'b.html'],
  )
})

test('ContentTree.merge nests, links parents and fills groups', () => {
  const root = new ContentTree('', ['pages'])
  const source = new ContentTree('', ['pages'])
  const sub = new ContentTree('sub', ['pages'])
  source.sub = sub
  const page = fakePlugin('sub/b.html')
  sub['b.md'] = page

  ContentTree.merge(root, source)

  assert.ok(root.sub instanceof ContentTree)
  assert.equal(root.sub['b.md'], page)
  assert.equal(page.parent, root.sub)
  assert.equal(root.sub.parent, root)
  assert.deepEqual(root._.directories, [root.sub])
  assert.deepEqual(root.sub._.pages, [page])
})

test('ContentTree.merge rejects foreign objects', () => {
  const root = new ContentTree('', ['pages'])
  const source = new ContentTree('', ['pages'])
  source.junk = 'not content'
  assert.throws(() => ContentTree.merge(root, source), /Invalid item in tree/)
})

test('ContentTree.inspect renders directories first, then names', () => {
  const root = new ContentTree('', ['pages'])
  root['z.md'] = fakePlugin('z.html')
  root['a.md'] = fakePlugin('a.html')
  const dir = new ContentTree('dir', ['pages'])
  dir['c.md'] = fakePlugin('dir/c.html')
  root.dir = dir

  const lines = ContentTree.inspect(root).split('\n')
  assert.match(lines[0], /dir\/$/)
  assert.match(lines[1], /c\.md/)
  assert.match(lines[2], /a\.md/)
  assert.match(lines[3], /z\.md/)
  // Nested entries are indented one level deeper than their parent.
  assert.match(lines[1], /^ {4}/)
  assert.match(lines[2], /^ {2}\S/)
  // util.inspect goes through the same renderer.
  assert.equal(util.inspect(root), ContentTree.inspect(root))
})

test('ContentTree.inspect rejects an unknown plugin colour', () => {
  const root = new ContentTree('', ['pages'])
  const page = fakePlugin('a.html')
  page.getPluginColor = () => 'octarine'
  root['a.md'] = page
  assert.throws(() => ContentTree.inspect(root), /invalid pluginColor/)
})
