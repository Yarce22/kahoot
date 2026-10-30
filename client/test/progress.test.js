import { describe, it, expect } from 'vitest'
import { summarize, statusCounts, byQuiz, byPunto } from '../src/lib/progress.js'

const row = (o = {}) => ({
  assignmentId: 'a', quizId: 'q1', quizTitle: 'Seguridad', status: 'pending',
  attemptStatus: null, scorePercent: null, ...o
})
const done = (score, o = {}) => row({ status: 'completed', attemptStatus: 'completed', scorePercent: score, ...o })

describe('summarize', () => {
  it('handles empty input', () => {
    expect(summarize([])).toEqual({ assigned: 0, completed: 0, completionPercent: 0, averageScore: null })
  })

  it('counts completed rows and rounds percent and average', () => {
    const rows = [done(80), done(71), row(), row({ attemptStatus: 'in_progress' })]
    expect(summarize(rows)).toEqual({ assigned: 4, completed: 2, completionPercent: 50, averageScore: 76 })
  })

  it('ignores null scores and non-completed attempts in the average', () => {
    const rows = [
      done(null),
      row({ attemptStatus: 'expired', scorePercent: 10 }),
      done(90)
    ]
    expect(summarize(rows).averageScore).toBe(90)
    expect(summarize([row({ attemptStatus: 'expired', scorePercent: 10 })]).averageScore).toBeNull()
  })
})

describe('statusCounts', () => {
  it('returns all four keys, zeros included', () => {
    expect(statusCounts([])).toEqual({ Completado: 0, 'En progreso': 0, Vencido: 0, Pendiente: 0 })
  })

  it('buckets rows by statusLabel', () => {
    const rows = [done(1), row(), row({ attemptStatus: 'expired' }), row({ attemptStatus: 'in_progress' }), row()]
    expect(statusCounts(rows)).toEqual({ Completado: 1, 'En progreso': 1, Vencido: 1, Pendiente: 2 })
  })
})

describe('byQuiz', () => {
  it('returns [] for no users', () => {
    expect(byQuiz([])).toEqual([])
  })

  it('groups by quizId across users, sorted by percent desc then title', () => {
    const users = [
      { quizzes: [done(80, { quizId: 'a', quizTitle: 'Beta' }), row({ quizId: 'b', quizTitle: 'Alfa' })] },
      { quizzes: [row({ quizId: 'a', quizTitle: 'Beta' }), row({ quizId: 'b', quizTitle: 'Alfa' }), row({ quizId: 'c', quizTitle: 'Cero' })] }
    ]
    expect(byQuiz(users)).toEqual([
      { quizId: 'a', quizTitle: 'Beta', assigned: 2, completed: 1, completionPercent: 50, averageScore: 80 },
      { quizId: 'b', quizTitle: 'Alfa', assigned: 2, completed: 0, completionPercent: 0, averageScore: null },
      { quizId: 'c', quizTitle: 'Cero', assigned: 1, completed: 0, completionPercent: 0, averageScore: null }
    ])
  })
})

describe('byPunto', () => {
  it('returns [] for no users', () => {
    expect(byPunto([])).toEqual([])
  })

  it('groups by punto, null under "Sin punto", sorted by percent desc then name', () => {
    const users = [
      { puntoDeVenta: 'Laureles', quizzes: [row(), row()] },
      { puntoDeVenta: 'Cerritos', quizzes: [done(60)] },
      { puntoDeVenta: null, quizzes: [done(100), row()] },
      { puntoDeVenta: 'Cerritos', quizzes: [row()] }
    ]
    expect(byPunto(users)).toEqual([
      { puntoDeVenta: 'Cerritos', assigned: 2, completed: 1, completionPercent: 50, averageScore: 60 },
      { puntoDeVenta: 'Sin punto', assigned: 2, completed: 1, completionPercent: 50, averageScore: 100 },
      { puntoDeVenta: 'Laureles', assigned: 2, completed: 0, completionPercent: 0, averageScore: null }
    ])
  })
})
