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

test('parseKeywords — trims, lowercases, drops empties', () => {
  assert.deepEqual(parseKeywords(' 500 , Lechuga ,, TOMATE '), ['500', 'lechuga', 'tomate'])
})
