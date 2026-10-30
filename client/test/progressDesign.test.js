import { describe, it, expect } from 'vitest'
import { scoreColor, daysAgo, relDate, scoreBuckets, lastActivity, attentionReasons } from '../src/lib/progress.js'

const NOW = new Date('2026-10-30T15:00:00')
const ago = (d) => new Date(NOW - d * 864e5).toISOString()

describe('dashboard design helpers', () => {
  it('scoreColor picks a band per score', () => {
    expect(scoreColor(null)).toBe('#a69d8e')
    expect(scoreColor(95)).toBe('#56633f')
    expect(scoreColor(65)).toBe('#7a8a5e')
    expect(scoreColor(45)).toBe('#d67f48')
    expect(scoreColor(10)).toBe('#8c491a')
  })

  it('relDate is relative for the last week', () => {
    expect(relDate(null, NOW)).toBe('—')
    expect(relDate(ago(0), NOW)).toBe('Hoy')
    expect(relDate(ago(1), NOW)).toBe('Ayer')
    expect(relDate(ago(3), NOW)).toBe('Hace 3 días')
    expect(daysAgo(ago(9), NOW)).toBe(9)
  })

  it('daysAgo counts calendar days, not elapsed 24h blocks', () => {
    expect(relDate(new Date('2026-10-29T20:00:00').toISOString(), NOW)).toBe('Ayer')
    expect(relDate(new Date('2026-10-30T00:30:00').toISOString(), NOW)).toBe('Hoy')
  })

  it('scoreBuckets counts scores into five bands', () => {
    expect(scoreBuckets([10, 39, 40, 85, 100, 90]).map((b) => b.n)).toEqual([2, 1, 0, 1, 2])
  })

  it('lastActivity returns the latest submittedAt or null', () => {
    expect(lastActivity({ quizzes: [{ submittedAt: ago(5) }, { submittedAt: ago(1) }, { submittedAt: null }] })).toBe(ago(1))
    expect(lastActivity({ quizzes: [] })).toBe(null)
  })

  it('attentionReasons flags expired, low average and inactivity', () => {
    const u = {
      assigned: 3, completed: 1, averageScore: 50,
      quizzes: [
        { status: 'completed', attemptStatus: 'completed', submittedAt: ago(12) },
        { status: 'pending', attemptStatus: 'expired', submittedAt: null },
        { status: 'pending', attemptStatus: null, submittedAt: null }
      ]
    }
    expect(attentionReasons(u, NOW)).toEqual(['1 vencido', 'promedio 50%', 'inactivo 12 días'])
    expect(attentionReasons({ assigned: 1, completed: 0, averageScore: null, quizzes: [{ status: 'pending' }] }, NOW)).toEqual(['sin actividad'])
    expect(attentionReasons({ assigned: 1, completed: 1, averageScore: 90, quizzes: [{ status: 'completed', attemptStatus: 'completed', submittedAt: ago(2) }] }, NOW)).toEqual([])
  })
})
