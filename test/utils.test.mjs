import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  callUser,
  extend,
  fileExists,
  mapLimit,
  readJSON,
  readdirRecursive,
  rfc822,
  stripExtension,
} from '../src/core/utils.js'

test('mapLimit preserves input order', async () => {
  const out = await mapLimit([5, 1, 3], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n))
    return n * 2
  })
  assert.deepEqual(out, [10, 2, 6])
})

test('mapLimit never exceeds the concurrency limit', async () => {
  let inFlight = 0
  let peak = 0
  await mapLimit(
    Array.from({ length: 20 }, (_, i) => i),
    4,
    async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
    },
  )
  assert.equal(peak, 4, 'this cap is what keeps config._fileLimit meaningful')
})

test('mapLimit propagates the first error and stops scheduling work', async () => {
  const seen = []
  await assert.rejects(
    mapLimit([1, 2, 3, 4, 5, 6], 1, async (n) => {
      seen.push(n)
      if (n === 2) throw new Error('boom')
    }),
    /boom/,
  )
  assert.deepEqual(seen, [1, 2], 'items after the failure must not run')
})

test('mapLimit handles an empty list', async () => {
  assert.deepEqual(await mapLimit([], 4, async () => 1), [])
})

test('callUser accepts a callback-style function', async () => {
  const result = await callUser((a, b, cb) => cb(null, a + b), null, [1, 2])
  assert.equal(result, 3)
})

test('callUser rejects when a callback-style function errors', async () => {
  await assert.rejects(
    callUser((cb) => cb(new Error('nope')), null, []),
    /nope/,
  )
})

test('callUser accepts a promise-returning function', async () => {
  const result = await callUser(async (a) => a * 2, null, [21])
  assert.equal(result, 42)
})

test('callUser catches a synchronous throw', async () => {
  await assert.rejects(
    callUser(
      () => {
        throw new Error('sync boom')
      },
      null,
      [],
    ),
    /sync boom/,
  )
})

test('callUser lets the returned promise win over a later callback', async () => {
  const result = await callUser(
    (cb) => {
      setTimeout(() => cb(null, 'callback'), 5)
      return Promise.resolve('promise')
    },
    null,
    [],
  )
  assert.equal(result, 'promise')
})

test('callUser binds thisArg', async () => {
  const owner = { name: 'page' }
  const result = await callUser(
    function (cb) {
      cb(null, this.name)
    },
    owner,
    [],
  )
  assert.equal(result, 'page')
})

test('extend copies inherited enumerable properties', () => {
  const base = { inherited: 1 }
  const mixin = Object.create(base)
  mixin.own = 2
  const target = {}
  extend(target, mixin)
  assert.deepEqual(target, { own: 2, inherited: 1 })
})

test('stripExtension removes only the last extension', () => {
  assert.equal(stripExtension('note.draft.md'), 'note.draft')
  assert.equal(stripExtension('noextension'), 'noextension')
})

test('async helpers support both promise and callback forms', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'coldsmith-utils-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const jsonPath = path.join(dir, 'data.json')
  await writeFile(jsonPath, '{"answer":42}')
  await mkdir(path.join(dir, 'nested'), { recursive: true })
  await writeFile(path.join(dir, 'nested', 'deep.txt'), 'x')

  await t.test('readJSON', async () => {
    assert.deepEqual(await readJSON(jsonPath), { answer: 42 })
    const viaCallback = await new Promise((resolve, reject) =>
      readJSON(jsonPath, (error, value) =>
        error ? reject(error) : resolve(value),
      ),
    )
    assert.deepEqual(viaCallback, { answer: 42 })
  })

  await t.test('readJSON names the file in parse errors', async () => {
    const bad = path.join(dir, 'bad.json')
    await writeFile(bad, '{ not json')
    await assert.rejects(readJSON(bad), /parsing bad\.json:/)
  })

  await t.test('fileExists keeps the legacy single-argument callback', async () => {
    assert.equal(await fileExists(jsonPath), true)
    assert.equal(await fileExists(path.join(dir, 'nope')), false)
    // fs.exists-style: one argument, no error. Plugins in the wild rely on it.
    const exists = await new Promise((resolve) =>
      fileExists(jsonPath, (...args) => resolve(args)),
    )
    assert.deepEqual(exists, [true])
  })

  await t.test('readdirRecursive descends', async () => {
    const found = (await readdirRecursive(dir)).sort()
    assert.ok(found.includes(path.join('nested', 'deep.txt')))
    assert.ok(found.includes('data.json'))
  })
})

test('rfc822 formats a UTC date', () => {
  assert.equal(
    rfc822(fakeDate({ day: 6, date: 3, month: 1, year: 2001, offset: 0 })),
    'Sat, 03 Feb 2001 04:05:06 +0000',
  )
})

test('rfc822 formats whole-hour offsets in both directions', () => {
  assert.match(
    rfc822(fakeDate({ day: 6, date: 3, month: 1, year: 2001, offset: 300 })),
    /-0500$/,
  )
  assert.match(
    rfc822(fakeDate({ day: 6, date: 3, month: 1, year: 2001, offset: -120 })),
    /\+0200$/,
  )
})

test('rfc822 formats half-hour offsets', () => {
  // Regression: computing hours and minutes from the offset separately
  // rounded Asia/Kolkata (UTC+5:30) to +0630.
  assert.match(
    rfc822(fakeDate({ day: 6, date: 3, month: 1, year: 2001, offset: -330 })),
    /\+0530$/,
  )
  assert.match(
    rfc822(fakeDate({ day: 6, date: 3, month: 1, year: 2001, offset: 210 })),
    /-0330$/,
  )
})

test('rfc822 spells August without a leading space', () => {
  // Regression: the month table had ' Aug', which produced a double space and
  // an invalid pubDate for every August post.
  assert.equal(
    rfc822(fakeDate({ day: 1, date: 4, month: 7, year: 2020, offset: 0 })),
    'Mon, 04 Aug 2020 04:05:06 +0000',
  )
})

/** rfc822 only reads these getters, so a plain object is enough to pin a zone. */
function fakeDate({ day, date, month, year, offset, h = 4, m = 5, s = 6 }) {
  return {
    getDay: () => day,
    getDate: () => date,
    getMonth: () => month,
    getFullYear: () => year,
    getHours: () => h,
    getMinutes: () => m,
    getSeconds: () => s,
    getTimezoneOffset: () => offset,
  }
}
