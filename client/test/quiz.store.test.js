import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const post = vi.hoisted(() => vi.fn())
const get = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ post, get, put: vi.fn(), del: vi.fn() })
}))

import { useQuizStore } from '../src/stores/quiz.js'

describe('quiz store createQuiz', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    post.mockReset()
  })

  it('normalizes the { quizId } response to a quiz exposing .id', async () => {
    post.mockResolvedValue({ quizId: 'quiz-123' })
    const store = useQuizStore()

    const quiz = await store.createQuiz({ title: 'Trivia', description: 'Fun' })

    // The editor redirect reads quiz.id — a { quizId } shape would send it to
    // /admin/quizzes/undefined.
    expect(quiz).toEqual({ id: 'quiz-123', title: 'Trivia', description: 'Fun' })
  })

  it('adds the created quiz (with .id) to the list', async () => {
    post.mockResolvedValue({ quizId: 'quiz-123' })
    const store = useQuizStore()

    await store.createQuiz({ title: 'Trivia' })

    expect(store.quizzes).toHaveLength(1)
    expect(store.quizzes[0].id).toBe('quiz-123')
  })

  it('defaults description to null when omitted', async () => {
    post.mockResolvedValue({ quizId: 'q' })
    const store = useQuizStore()

    const quiz = await store.createQuiz({ title: 'X' })

    expect(quiz.description).toBeNull()
  })
})

describe('quiz store createSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    post.mockReset()
  })

  it('posts the quizId and returns the session (with pin)', async () => {
    post.mockResolvedValue({ pin: '123456' })
    const store = useQuizStore()

    const res = await store.createSession('quiz-1')

    expect(post).toHaveBeenCalledWith('/api/sessions', { quizId: 'quiz-1' })
    expect(res).toEqual({ pin: '123456' })
  })
})

describe('quiz store session history', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    get.mockReset()
  })

  it('fetchQuizSessions unwraps the { sessions } payload', async () => {
    const sessions = [{ id: 's1', pin: '111111', playerCount: 8 }]
    get.mockResolvedValue({ sessions })
    const store = useQuizStore()

    const res = await store.fetchQuizSessions('quiz-1')

    expect(get).toHaveBeenCalledWith('/api/quizzes/quiz-1/sessions')
    expect(res).toEqual(sessions)
  })

  it('fetchSessionResults returns the raw results payload for a pin', async () => {
    const payload = { leaderboard: [], results: [] }
    get.mockResolvedValue(payload)
    const store = useQuizStore()

    const res = await store.fetchSessionResults('111111')

    expect(get).toHaveBeenCalledWith('/api/sessions/111111/results')
    expect(res).toBe(payload)
  })
})
