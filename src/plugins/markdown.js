/** Markdown and JSON page plugins. */

import { readFile } from 'node:fs/promises'
import url from 'node:url'

import hljs from 'highlight.js'
import { load as loadYaml } from 'js-yaml'
import { Marked } from 'marked'
import { gfmHeadingId } from 'marked-gfm-heading-id'
import { markedHighlight } from 'marked-highlight'
import { markedSmartypants } from 'marked-smartypants'

import { dual } from '../core/utils.js'

/** Split a uri into the pieces link resolution cares about. */
function splitUri(uri) {
  const hashAt = uri.indexOf('#')
  const hash = hashAt === -1 ? null : uri.slice(hashAt)
  let rest = hashAt === -1 ? uri : uri.slice(0, hashAt)
  const queryAt = rest.indexOf('?')
  if (queryAt !== -1) rest = rest.slice(0, queryAt)
  const protocol = /^[a-z][a-z0-9+.-]*:/i.test(rest)
  return { protocol, hash, pathname: rest }
}

/**
 * Resolve *uri* relative to *content* by walking the content tree, falling
 * back to *baseUrl* when nothing in the tree matches.
 */
export function resolveLink(content, uri, baseUrl) {
  const parts = splitUri(uri)

  // Absolute uri.
  if (parts.protocol) return uri
  // Bare fragment.
  if (parts.hash === uri) return uri

  // Walk the tree relative to *content*.
  let nav = content.parent
  const segments = parts.pathname ? parts.pathname.split('/') : []
  while (segments.length && nav != null) {
    const part = segments.shift()
    if (part === '') {
      // A leading slash means the root of the content tree.
      while (nav.parent) nav = nav.parent
    } else if (part === '..') {
      nav = nav.parent
    } else {
      nav = nav[part]
    }
  }

  if (nav?.getUrl != null) {
    return nav.getUrl() + (parts.hash ?? '')
  }
  return url.resolve(baseUrl, uri)
}

/**
 * Parse *markdown* found on the *content* node, resolving relative links
 * through the content tree and falling back to *baseUrl*.
 */
function parseMarkdownSync(content, markdown, baseUrl, options) {
  // A fresh instance per parse. Wintersmith 2 monkeypatched marked's inline
  // lexer prototype and called the process-global setOptions, which made
  // concurrent renders of different pages capable of stealing each other's
  // link resolution.
  const extensions = [
    // marked dropped built-in heading ids in v5. Without this, every in-page
    // anchor link on every existing wintersmith site breaks.
    gfmHeadingId(),
  ]

  // marked dropped the smartypants option in v5 as well. It is a documented
  // config key that visibly changes a site's typography, so it is honoured
  // through the official extension instead.
  if (options.smartypants) extensions.push(markedSmartypants())

  const parser = new Marked(
    ...extensions,
    markedHighlight({
      emptyLangClass: '',
      langPrefix: 'language-',
      highlight(code, lang) {
        try {
          if (lang === 'auto') return hljs.highlightAuto(code).value
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value
          }
        } catch {
          // An unhighlightable block is not worth failing a build over.
        }
        // Null leaves marked to escape and emit the code as-is.
        return null
      },
    }),
    {
      ...options,
      walkTokens(token) {
        if (token.type === 'link' || token.type === 'image') {
          token.href = resolveLink(content, token.href, baseUrl)
        }
      },
    },
  )

  return parser.parse(markdown)
}

/** Split front matter from markdown body. Supports both metadata syntaxes. */
function splitMetadata(content) {
  if (content.slice(0, 3) === '---') {
    // "Front Matter"
    const result = content.match(/^-{3,}\s([\s\S]*?)-{3,}(\s[\s\S]*|\s?)$/)
    if (result?.length === 3) {
      return { metadata: result[1], markdown: result[2] }
    }
  } else if (content.slice(0, 12) === '```metadata\n') {
    // "Winter Matter"
    const end = content.indexOf('\n```\n')
    if (end !== -1) {
      return {
        metadata: content.substring(12, end),
        markdown: content.substring(end + 5),
      }
    }
  }
  return { metadata: '', markdown: content }
}

function parseMetadata(source) {
  if (source.length === 0) return {}
  try {
    return loadYaml(source) || {}
  } catch (error) {
    if (error.reason != null && error.mark != null) {
      const lines = error.mark.buffer.split('\n')
      const marker = ' '.repeat(error.mark.column)
      error.message = `YAML: ${error.reason}\n\n    ${lines[error.mark.line]}\n    ${marker}^\n`
    } else {
      error.message = `YAML Parsing error ${error.message}`
    }
    throw error
  }
}

export default function (env, callback) {
  // Highlight.js configuration.
  const hljsConfig = { classPrefix: '', ...(env.config.highlightjs || {}) }
  hljs.configure(hljsConfig)

  class MarkdownPage extends env.plugins.Page {
    constructor(filepath, metadata, markdown) {
      super(filepath, metadata)
      this.markdown = markdown
    }

    getLocation(base) {
      const uri = this.getUrl(base)
      return uri.slice(0, uri.lastIndexOf('/') + 1)
    }

    /** Parse the markdown, resolving relative urls to absolute ones. */
    getHtml(base = env.config.baseUrl) {
      const options = env.config.markdown || {}
      return parseMarkdownSync(this, this.markdown, this.getLocation(base), options)
    }
  }

  MarkdownPage.fromFile = async function (filepath) {
    const buffer = await readFile(filepath.full)
    const { metadata, markdown } = await this.extractMetadata(buffer.toString())
    return new this(filepath, metadata, markdown)
  }

  /** Split *content* into its metadata and markdown. Dual-signature. */
  MarkdownPage.extractMetadata = function (content, callback) {
    const promise = (async () => {
      const split = splitMetadata(content)
      return {
        metadata: parseMetadata(split.metadata),
        markdown: split.markdown,
      }
    })()
    return dual(promise, callback)
  }

  MarkdownPage.resolveLink = resolveLink

  /** Pages built from metadata alone, in a JSON file. */
  class JsonPage extends MarkdownPage {}

  JsonPage.fromFile = async function (filepath) {
    const metadata = await env.utils.readJSON(filepath.full)
    return new this(filepath, metadata, metadata.content || '')
  }

  env.registerContentPlugin('pages', '**/*.*(markdown|mkd|md)', MarkdownPage)
  env.registerContentPlugin('pages', '**/*.json', JsonPage)

  callback()
}
