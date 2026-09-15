import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useUserApi.js', () => ({
  useUserApi: () => ({ get, post, put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

import { useUserQuizzesStore } from '../src/stores/userQuizzes.js'

describe('userQuizzes store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    get.mockReset()
    post.mockReset()
  })

  it('fetchQuizzes loads the paginated list', async () => {
    get.mockResolvedValue({
      quizzes: [{ assignmentId: 'a1', quizId: 'q1', title: 'Quiz 1', description: null, totalTimeSeconds: 600, status: 'pending', cycle: 1, assignedAt: '2026-01-01', attempt: null }],
      page: 1,
      page_size: 25,
      total: 1
    })
    const store = useUserQuizzesStore()
    await store.fetchQuizzes()
    expect(get).toHaveBeenCalledWith('/api/user/quizzes')
    expect(store.quizzes).toHaveLength(1)
    expect(store.page).toBe(1)
    expect(store.pageSize).toBe(25)
    expect(store.total).toBe(1)
  })

  it('fetchQuizzes forwards the page query param', async () => {
    get.mockResolvedValue({ quizzes: [], page: 2, page_size: 25, total: 30 })
    const store = useUserQuizzesStore()
    await store.fetchQuizzes({ page: 2 })
    expect(get).toHaveBeenCalledWith('/api/user/quizzes?page=2')
  })

  it('surfaces fetch errors into store.error', async () => {
    get.mockRejectedValue(new Error('boom'))
    const store = useUserQuizzesStore()
    await store.fetchQuizzes()
    expect(store.error).toBe('boom')
  })

  it('startAttempt posts to the assignment attempt route and returns the response verbatim', async () => {
    const response = { attempt: { id: 'att1', startedAt: 't0', expiresAt: 't1', timeBudgetSeconds: 600 }, questions: [] }
    post.mockResolvedValue(response)
    const store = useUserQuizzesStore()
    const res = await store.startAttempt('a1')
    expect(post).toHaveBeenCalledWith('/api/user/quizzes/a1/attempt')
    expect(res).toBe(response)
  })

  it('submitAnswer posts the answer payload to the attempt', async () => {
    post.mockResolvedValue({ recorded: true })
    const store = useUserQuizzesStore()
    const payload = { questionId: 'q1', selectedOptionId: 'o1' }
    await store.submitAnswer('att1', payload)
    expect(post).toHaveBeenCalledWith('/api/user/attempts/att1/answers', payload)
  })

  it('submitAttempt posts submit and returns the result verbatim', async () => {
    const response = { result: { attemptId: 'att1', status: 'completed', totalQuestions: 2, correctCount: 1, scorePercent: 50, submittedAt: 't2', answers: [] } }
    post.mockResolvedValue(response)
    const store = useUserQuizzesStore()
    const res = await store.submitAttempt('att1')
    expect(post).toHaveBeenCalledWith('/api/user/attempts/att1/submit')
    expect(res).toBe(response)
  })

  it('fetchResult gets the result and returns it verbatim', async () => {
    const response = { result: { attemptId: 'att1', status: 'completed', totalQuestions: 2, correctCount: 2, scorePercent: 100, submittedAt: 't2', answers: [] } }
    get.mockResolvedValue(response)
    const store = useUserQuizzesStore()
    const res = await store.fetchResult('att1')
    expect(get).toHaveBeenCalledWith('/api/user/attempts/att1/result')
    expect(res).toBe(response)
  })
})
