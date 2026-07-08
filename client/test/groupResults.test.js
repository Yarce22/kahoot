import { describe, it, expect } from 'vitest'
import { groupResultsByPlayer } from '../src/lib/groupResults.js'

describe('groupResultsByPlayer', () => {
  it('groups rows by player nickname', () => {
    const rows = [
      { player: { nickname: 'Ana' }, question: { text: 'Q1', order_index: 0 }, is_correct: true },
      { player: { nickname: 'Beto' }, question: { text: 'Q1', order_index: 0 }, is_correct: false },
      { player: { nickname: 'Ana' }, question: { text: 'Q2', order_index: 1 }, is_correct: false }
    ]
    const grouped = groupResultsByPlayer(rows)
    expect(grouped).toHaveLength(2)
    expect(grouped.find(p => p.nickname === 'Ana').answers).toHaveLength(2)
  })

  it('orders each player answers by question order_index', () => {
    const rows = [
      { player: { nickname: 'Ana' }, question: { text: 'Q2', order_index: 1 }, is_correct: false },
      { player: { nickname: 'Ana' }, question: { text: 'Q1', order_index: 0 }, is_correct: true }
    ]
    const [ana] = groupResultsByPlayer(rows)
    expect(ana.answers.map(a => a.questionText)).toEqual(['Q1', 'Q2'])
  })

  it('prefers the open answer_text, falling back to the selected option text', () => {
    const rows = [
      { player: { nickname: 'Ana' }, question: { text: 'Q1', order_index: 0 }, answer_text: 'lechuga', is_correct: true },
      { player: { nickname: 'Ana' }, question: { text: 'Q2', order_index: 1 }, selected_option: { text: 'Opción B' }, is_correct: false }
    ]
    const [ana] = groupResultsByPlayer(rows)
    expect(ana.answers[0].answer).toBe('lechuga')
    expect(ana.answers[1].answer).toBe('Opción B')
  })

  it('falls back to a placeholder nickname and empty defaults for missing fields', () => {
    const [entry] = groupResultsByPlayer([{ is_correct: null }])
    expect(entry.nickname).toBe('Desconocido')
    expect(entry.answers[0]).toMatchObject({ questionText: '', order: 0, answer: null, timeTakenMs: null })
  })

  it('returns an empty array for no results', () => {
    expect(groupResultsByPlayer()).toEqual([])
    expect(groupResultsByPlayer([])).toEqual([])
  })
})
