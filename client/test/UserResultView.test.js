import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useUserApi.js', () => ({
  useUserApi: () => ({ get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

const { routeParams } = vi.hoisted(() => ({ routeParams: { id: 'att1' } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeParams })
}))

import UserResultView from '../src/views/user/UserResultView.vue'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(UserResultView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

function result(overrides = {}) {
  return {
    attemptId: 'att1',
    status: 'completed',
    totalQuestions: 3,
    correctCount: 2,
    scorePercent: 67,
    submittedAt: '2026-01-01T12:00:00Z',
    answers: [
      { questionId: 'q1', questionText: '¿2+2?', answerText: '4', isCorrect: true },
      { questionId: 'q2', questionText: '¿5x5?', answerText: '20', isCorrect: false },
      { questionId: 'q3', questionText: 'Abierta', answerText: 'algo', isCorrect: null }
    ],
    ...overrides
  }
}

describe('UserResultView', () => {
  beforeEach(() => {
    get.mockReset()
  })

  it('fetches the result for the route attempt id and renders the score', async () => {
    get.mockResolvedValue({ result: result() })
    const wrapper = mountView()
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/api/user/attempts/att1/result')
    expect(wrapper.text()).toContain('2/3 correctas')
    expect(wrapper.text()).toContain('67%')
  })

  // Same three-state icon pattern as SessionResultsView.vue: true/false/null
  // -> ✅/❌/— (open-question grading can legitimately land on null).
  it('renders ✅/❌/— for true/false/null isCorrect', async () => {
    get.mockResolvedValue({ result: result() })
    const wrapper = mountView()
    await flushPromises()

    const rows = wrapper.findAll('.answer-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('✅')
    expect(rows[1].text()).toContain('❌')
    expect(rows[2].text()).toContain('—')
  })

  it('shows an inline message on 409 ATTEMPT_STILL_IN_PROGRESS instead of crashing', async () => {
    get.mockRejectedValue(new Error('ATTEMPT_STILL_IN_PROGRESS'))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.error-msg').text()).toContain('en progreso')
    expect(wrapper.find('a[href="/user/quizzes"]').exists()).toBe(true)
  })

  it('shows a fallback message for an answered question with no text', async () => {
    get.mockResolvedValue({ result: result({ answers: [{ questionId: 'q1', questionText: 'Sin respuesta', answerText: null, isCorrect: false }] }) })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.answer-text').text()).toBe('(sin respuesta)')
  })
})
