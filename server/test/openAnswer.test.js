import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchOpenAnswer, parseKeywords } from '../src/domain/openAnswer.js'

const KEYWORDS = '500, lechuga, tomate, cebolla'

test('matchOpenAnswer — correct when all keywords are present', () => {
  assert.equal(
    matchOpenAnswer('lleva 500gr de carne y ensalada de lechuga, tomate y cebolla', KEYWORDS),
    true
  )
})

test('matchOpenAnswer — incorrect when a keyword is missing', () => {
  assert.equal(matchOpenAnswer('lleva carne con lechuga y tomate', KEYWORDS), false)
})

test('matchOpenAnswer — case and accent insensitive', () => {
  assert.equal(matchOpenAnswer('500 LECHÚGA TOMATE CEBOLLA', KEYWORDS), true)
})

test('matchOpenAnswer — matches keywords as substrings (500 in 500gr)', () => {
  assert.equal(matchOpenAnswer('500gr lechuga tomate cebolla', KEYWORDS), true)
})

test('matchOpenAnswer — empty keyword list is never correct', () => {
  assert.equal(matchOpenAnswer('anything at all', ''), false)
  assert.equal(matchOpenAnswer('anything', '   ,  , '), false)
})

test('matchOpenAnswer — empty/undefined response is not correct', () => {
  assert.equal(matchOpenAnswer('', KEYWORDS), false)
  assert.equal(matchOpenAnswer(undefined, KEYWORDS), false)
})

test('matchOpenAnswer — keywords match regardless of order in the response', () => {
  assert.equal(
    matchOpenAnswer('con cebolla, tomate, lechuga y 500gr de carne', KEYWORDS),
    true
  )
})

test('matchOpenAnswer — a multi-word keyword must appear contiguously', () => {
  // "tomate cherry" is ONE keyword (a phrase), not two.
  const kw = '200, guisantes, tomate cherry, stracciatella'
  assert.equal(
    matchOpenAnswer('200 gr, guisantes, tomate cherry y stracciatella', kw),
    true
  )
  // Same words present but the phrase is broken up → not a match.
  assert.equal(
    matchOpenAnswer('200 gr, guisantes, cherry con tomate, stracciatella', kw),
    false
  )
})

test('matchOpenAnswer — multi-word keywords still match in any order relative to each other', () => {
  const kw = 'tomate cherry, stracciatella'
  assert.equal(matchOpenAnswer('stracciatella y tomate cherry', kw), true)
})

test('matchOpenAnswer — a stored keyword with trailing punctuation still matches', () => {
  // A key phrase saved as "stracciatella." (trailing period) must not require
  // the player to type the period too.
  assert.equal(matchOpenAnswer('me encanta la stracciatella', 'stracciatella.'), true)
  assert.equal(matchOpenAnswer('lechuga, tomate y cebolla', '¡lechuga!, tomate, cebolla.'), true)
})

test('parseKeywords — trims surrounding punctuation from each keyword', () => {
  assert.deepEqual(parseKeywords('¡lechuga!, tomate., "cebolla"'), ['lechuga', 'tomate', 'cebolla'])
})

test('parseKeywords — splits on commas only (keywords may be multi-word phrases)', () => {
  assert.deepEqual(parseKeywords(' 500 , Lechuga ,, TOMATE '), ['500', 'lechuga', 'tomate'])
  assert.deepEqual(parseKeywords('200, tomate cherry, stracciatella'), ['200', 'tomate cherry', 'stracciatella'])
})
