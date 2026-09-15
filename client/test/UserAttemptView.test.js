import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useUserApi.js', () => ({
  useUserApi: () => ({ get, post, put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

const { push, routeParams } = vi.hoisted(() => ({ push: vi.fn(), routeParams: { assignmentId: 'a1' } }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: routeParams })
}))

import UserAttemptView from '../src/views/user/UserAttemptView.vue'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(UserAttemptView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

// One question of each type — the four submit payload shapes this view must
// get exactly right (server contract: userQuizzes.js's POST /answers).
const QUESTIONS = [
  { id: 'q1', text: '¿2+2?', type: 'closed', orderIndex: 0, options: [{ id: 'o1', text: '4' }, { id: 'o2', text: '5' }] },
  { id: 'q2', text: '¿La Tierra es redonda?', type: 'true_false', orderIndex: 1, options: [{ id: 'o3', text: 'Verdadero' }, { id: 'o4', text: 'Falso' }] },
  { id: 'q3', text: 'Elegí las vocales', type: 'multiple', orderIndex: 2, options: [{ id: 'o5', text: 'a' }, { id: 'o6', text: 'b' }, { id: 'o7', text: 'e' }] },
  { id: 'q4', text: 'Describí tu experiencia', type: 'open', orderIndex: 3, options: [] }
]

const FUTURE_ISO = new Date(Date.now() + 10 * 60 * 1000).toISOString()

function startAttemptResponse(overrides = {}) {
  return {
    attempt: { id: 'att1', startedAt: new Date().toISOString(), expiresAt: FUTURE_ISO, timeBudgetSeconds: 600 },
    questions: QUESTIONS,
    ...overrides
  }
}

describe('UserAttemptView', () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
    push.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts the attempt on mount and renders the first question', async () => {
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/user/quizzes/a1/attempt')
    expect(wrapper.text()).toContain('¿2+2?')
    expect(wrapper.text()).toContain('Pregunta 1 de 4')
  })

  it('sends { questionId, selectedOptionId } for a closed question', async () => {
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    post.mockResolvedValueOnce({ recorded: true })
    await wrapper.findAll('.option-list button')[0].trigger('click')
    await flushPromises()

    expect(post).toHaveBeenLastCalledWith('/api/user/attempts/att1/answers', { questionId: 'q1', selectedOptionId: 'o1' })
  })

  it('sends { questionId, selectedOptionId } for a true_false question (same shape as closed)', async () => {
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('.attempt-nav button')[1].trigger('click') // Siguiente -> q2

    post.mockResolvedValueOnce({ recorded: true })
    await wrapper.findAll('.option-list button')[1].trigger('click') // "Falso"
    await flushPromises()

    expect(post).toHaveBeenLastCalledWith('/api/user/attempts/att1/answers', { questionId: 'q2', selectedOptionId: 'o4' })
  })

  it('sends { questionId, selectedOptionIds } for a multiple question via the explicit send button', async () => {
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('.attempt-nav button')[1].trigger('click') // q2
    await wrapper.findAll('.attempt-nav button')[1].trigger('click') // q3 (multiple)

    const checkboxes = wrapper.findAll('.checkbox-row input[type=checkbox]')
    await checkboxes[0].setValue(true)
    await checkboxes[2].setValue(true)

    post.mockResolvedValueOnce({ recorded: true })
    await wrapper.find('.option-list button').trigger('click') // Enviar respuesta
    await flushPromises()

    expect(post).toHaveBeenLastCalledWith('/api/user/attempts/att1/answers', { questionId: 'q3', selectedOptionIds: ['o5', 'o7'] })
  })

  it('sends { questionId, answerText } for an open question via the explicit send button, trimmed', async () => {
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('.attempt-nav button')[1].trigger('click') // q2
    await wrapper.findAll('.attempt-nav button')[1].trigger('click') // q3
    await wrapper.findAll('.attempt-nav button')[1].trigger('click') // q4 (open)

    await wrapper.find('.open-answer input').setValue('  mi respuesta  ')
    post.mockResolvedValueOnce({ recorded: true })
    await wrapper.find('.open-answer button').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenLastCalledWith('/api/user/attempts/att1/answers', { questionId: 'q4', answerText: 'mi respuesta' })
  })

  it('shows the server error inline with a link back to /user/quizzes on an attempt-start 409', async () => {
    post.mockRejectedValueOnce(new Error('ATTEMPT_ALREADY_COMPLETED'))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.error-msg').text()).toBe('ATTEMPT_ALREADY_COMPLETED')
    expect(wrapper.find('a[href="/user/quizzes"]').exists()).toBe(true)
  })

  it('freezes answering and shows a banner on an ATTEMPT_EXPIRED answer error', async () => {
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    post.mockRejectedValueOnce(new Error('ATTEMPT_EXPIRED'))
    await wrapper.findAll('.option-list button')[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('.error-msg').exists()).toBe(true)
    expect(wrapper.findAll('.option-list button')[0].attributes('disabled')).toBeDefined()
  })

  it('Entregar examen is gated by confirm() — does nothing if the usuario cancels', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.btn-coral').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledTimes(1) // only the initial startAttempt call
    expect(push).not.toHaveBeenCalled()
  })

  it('Entregar examen submits and navigates to the result route when confirmed', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    post.mockResolvedValueOnce({ result: { attemptId: 'att1', status: 'completed', totalQuestions: 4, correctCount: 0, scorePercent: 0, submittedAt: 't', answers: [] } })
    await wrapper.find('.btn-coral').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenLastCalledWith('/api/user/attempts/att1/submit')
    expect(push).toHaveBeenCalledWith('/user/attempts/att1/result')
  })

  // Design decision: ALREADY_SUBMITTED/EXPIRED on submit mean the attempt is
  // finalized one way or another already — still navigate to the result
  // route rather than surfacing an error for something that already happened.
  it('still navigates to the result route on a 409 ATTEMPT_ALREADY_SUBMITTED from Entregar', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    post.mockRejectedValueOnce(new Error('ATTEMPT_ALREADY_SUBMITTED'))
    await wrapper.find('.btn-coral').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/user/attempts/att1/result')
  })

  it('still navigates to the result route on a 409 ATTEMPT_EXPIRED from Entregar', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    post.mockResolvedValueOnce(startAttemptResponse())
    const wrapper = mountView()
    await flushPromises()

    post.mockRejectedValueOnce(new Error('ATTEMPT_EXPIRED'))
    await wrapper.find('.btn-coral').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/user/attempts/att1/result')
  })

  it('auto-submits once, without confirm(), when the countdown reaches zero', async () => {
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const baseTime = new Date('2026-01-01T00:00:00Z').getTime()
    vi.useFakeTimers({ now: baseTime })

    post.mockResolvedValueOnce(startAttemptResponse({
      attempt: { id: 'att1', startedAt: new Date(baseTime).toISOString(), expiresAt: new Date(baseTime + 2000).toISOString(), timeBudgetSeconds: 2 }
    }))
    mountView()
    await vi.advanceTimersByTimeAsync(0) // let startAttempt's promise resolve

    post.mockResolvedValueOnce({ result: { attemptId: 'att1', status: 'completed', totalQuestions: 4, correctCount: 0, scorePercent: 0, submittedAt: 't', answers: [] } })
    await vi.advanceTimersByTimeAsync(3000) // ticks past the 2s expiry

    expect(confirmMock).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith('/api/user/attempts/att1/submit')
    expect(push).toHaveBeenCalledWith('/user/attempts/att1/result')
  })
})
