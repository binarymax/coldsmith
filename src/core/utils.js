/**
 * Shared helpers.
 *
 * This module is also public API: Environment exposes it as `env.utils`, and
 * plugins in the wild call `env.utils.extend`, `env.utils.stripExtension` and
 * `env.utils.rfc822`. Nothing here may be renamed or removed without a major.
 *
 * The async functions are dual-signature. They return a promise, and they also
 * accept a trailing node-style callback for code written against wintersmith 2.
 * New code should use the promise form; the callback form is deprecated but
 * supported.
 */

import fs from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * Bridge a promise to an optional node-style callback.
 *
 * When a callback is supplied the promise is consumed here and `undefined` is
 * returned, so a caller can never end up with an unhandled rejection. A
 * callback that throws is rethrown asynchronously rather than being swallowed
 * into a rejected promise, which is what the callers of these functions - and
 * the preview server's uncaughtException handler - expect.
 */
export function dual(promise, callback) {
  if (typeof callback !== 'function') {
    return promise
  }
  promise
    .then(
      (value) => callback(null, value),
      (error) => callback(error),
    )
    .catch((error) => {
      setImmediate(() => {
        throw error
      })
    })
  return undefined
}

/**
 * Invoke a user-supplied function that may be callback-style or may return a
 * promise, and always get a promise back.
 *
 * This is how every extension point is called: plugin modules, views,
 * `fromFile` factories, `render` methods and generator functions. Passing the
 * callback unconditionally is what keeps callback-style plugins working; if
 * the function also returns a thenable, the thenable wins and any later
 * callback invocation is ignored.
 */
export function callUser(fn, thisArg, args = []) {
  return new Promise((resolve, reject) => {
    let settled = false
    const callback = (error, result) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(result)
    }

    let returned
    try {
      returned = fn.apply(thisArg, [...args, callback])
    } catch (error) {
      callback(error)
      return
    }

    if (returned != null && typeof returned.then === 'function') {
      settled = true
      returned.then(resolve, reject)
    }
  })
}

/**
 * Map over *items* with at most *limit* calls to *fn* in flight.
 *
 * This is not a convenience: `config._fileLimit` exists to cap the number of
 * simultaneously open file descriptors while scanning and rendering a content
 * tree, and unbounded Promise.all would blow past it on a large site.
 *
 * Results keep input order. The first rejection is propagated once work
 * already in flight has settled; no new work is started after a failure.
 */
export async function mapLimit(items, limit, fn) {
  const list = Array.from(items)
  const results = new Array(list.length)
  if (list.length === 0) return results

  const width = Math.max(1, Math.min(limit || list.length, list.length))
  let next = 0
  let failure = null

  const worker = async () => {
    while (failure === null) {
      const index = next++
      if (index >= list.length) return
      try {
        results[index] = await fn(list[index], index)
      } catch (error) {
        failure ??= error
      }
    }
  }

  await Promise.all(Array.from({ length: width }, worker))
  if (failure !== null) throw failure
  return results
}

/** Copy every enumerable property of *mixin* onto *obj*, prototype chain included. */
export function extend(obj, mixin) {
  for (const name in mixin) {
    obj[name] = mixin[name]
  }
}

/** Remove the file extension from *filename*. */
export function stripExtension(filename) {
  return filename.replace(/(.+)\.[^.]+$/, '$1')
}

/**
 * Does *pathname* exist?
 *
 * The callback form takes a single `exists` argument and no error, matching
 * the long-removed `fs.exists`. Kept for wintersmith 2 compatibility.
 */
export function fileExists(pathname, callback) {
  const promise = stat(pathname).then(
    () => true,
    () => false,
  )
  if (typeof callback !== 'function') {
    return promise
  }
  promise.then((exists) => callback(exists))
  return undefined
}

export function fileExistsSync(pathname) {
  return fs.existsSync(pathname)
}

/** Read and parse *filename* as JSON. */
export function readJSON(filename, callback) {
  const promise = (async () => {
    const buffer = await readFile(filename)
    try {
      return JSON.parse(buffer.toString())
    } catch (error) {
      // Only parse failures get decorated; a read failure keeps its own
      // message, which already names the path.
      error.filename = filename
      error.message = `parsing ${path.basename(filename)}: ${error.message}`
      throw error
    }
  })()
  return dual(promise, callback)
}

export function readJSONSync(filename) {
  return JSON.parse(fs.readFileSync(filename).toString())
}

/** Every file under *directory*, recursively, as paths relative to it. */
export function readdirRecursive(directory, callback) {
  const walk = async (relativeDir) => {
    const found = []
    const filenames = await readdir(path.join(directory, relativeDir))
    const nested = await Promise.all(
      filenames.map(async (filename) => {
        const relative = path.join(relativeDir, filename)
        const stats = await stat(path.join(directory, relative))
        return stats.isDirectory() ? walk(relative) : [relative]
      }),
    )
    for (const entry of nested) found.push(...entry)
    return found
  }
  return dual(walk(''), callback)
}

/** Pipe *source* into *destination*. */
export function pump(source, destination, callback) {
  return dual(pipeline(source, destination), callback)
}

const RFC822_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const RFC822_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * Format a Date as RFC 822, for RSS pubDate fields.
 * http://www.w3.org/Protocols/rfc822/#z28
 */
export function rfc822(date) {
  const offset = date.getTimezoneOffset()
  // getTimezoneOffset is minutes *behind* UTC, so a positive value is a
  // negative zone. Work in total minutes: computing hours and minutes
  // separately gets half-hour and three-quarter-hour zones wrong.
  const total = Math.abs(offset)
  const tz =
    (offset > 0 ? '-' : '+') + pad2(Math.floor(total / 60)) + pad2(total % 60)

  const time = [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join(':')

  return [
    RFC822_DAYS[date.getDay()] + ',',
    pad2(date.getDate()),
    RFC822_MONTHS[date.getMonth()],
    date.getFullYear(),
    time,
    tz,
  ].join(' ')
}
