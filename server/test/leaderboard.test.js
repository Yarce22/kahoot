import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankPlayers } from '../src/domain/leaderboard.js'

test('rankPlayers — orders by score desc and assigns 1-based rank', () => {
  const ranked = rankPlayers([
    { nickname: 'ana', score: 2, totalTimeMs: 1000 },
    { nickname: 'bea', score: 5, totalTimeMs: 3000 },
    { nickname: 'cno', score: 3, totalTimeMs: 2000 }
  ])
  assert.deepEqual(ranked.map(r => [r.rank, r.nickname]), [
    [1, 'bea'],
    [2, 'cno'],
    [3, 'ana']
  ])
})

test('rankPlayers — breaks score ties by lower total time (faster wins)', () => {
  const ranked = rankPlayers([
    { nickname: 'slow', score: 4, totalTimeMs: 9000 },
    { nickname: 'fast', score: 4, totalTimeMs: 4000 }
  ])
  assert.deepEqual(ranked.map(r => r.nickname), ['fast', 'slow'])
  assert.equal(ranked[0].rank, 1)
})

test('rankPlayers — does not mutate the input array', () => {
  const input = [
    { nickname: 'a', score: 1, totalTimeMs: 10 },
    { nickname: 'b', score: 2, totalTimeMs: 20 }
  ]
  const copy = [...input]
  rankPlayers(input)
  assert.deepEqual(input, copy)
})

test('rankPlayers — empty input returns empty array', () => {
  assert.deepEqual(rankPlayers([]), [])
})
