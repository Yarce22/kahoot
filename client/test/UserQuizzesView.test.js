import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useUserApi.js', () => ({
  useUserApi: () => ({ get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

import UserQuizzesView from '../src/views/user/UserQuizzesView.vue'
import { useUserAuthStore } from '../src/stores/userAuth.js'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(UserQuizzesView, { global: { plugins: [pinia] } })
}

function quizRow(overrides = {}) {
  return {
    assignmentId: 'a1',
    quizId: 'q1',
    title: 'Seguridad en el punto de venta',
    description: 'Capacitación obligatoria',
    totalTimeSeconds: 600,
    status: 'pending',
    cycle: 1,
    assignedAt: '2026-01-01T00:00:00Z',
    attempt: null,
    ...overrides
  }
}

describe('UserQuizzesView', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
    push.mockClear()
  })

  it('shows "Comenzar" and starts the attempt route when there is no attempt yet', async () => {
    get.mockResolvedValue({ quizzes: [quizRow()], page: 1, page_size: 25, total: 1 })
    const wrapper = mountView()
    await flushPromises()

    const btn = wrapper.find('.btn-primary')
    expect(btn.text()).toBe('Comenzar')
    await btn.trigger('click')
    expect(push).toHaveBeenCalledWith('/user/quizzes/a1/attempt')
  })

  it('shows "Continuar" and goes to the same attempt route for an in_progress attempt', async () => {
    get.mockResolvedValue({
      quizzes: [quizRow({ attempt: { id: 'att1', status: 'in_progress', startedAt: 't0', expiresAt: 't1', submittedAt: null, correctCount: null, totalQuestions: null, scorePercent: null } })],
      page: 1, page_size: 25, total: 1
    })
    const wrapper = mountView()
    await flushPromises()

    const btn = wrapper.find('.btn-primary')
    expect(btn.text()).toBe('Continuar')
    await btn.trigger('click')
    expect(push).toHaveBeenCalledWith('/user/quizzes/a1/attempt')
  })

  it('shows "Ver resultado" and goes to the result route for a completed attempt', async () => {
    get.mockResolvedValue({
      quizzes: [quizRow({ attempt: { id: 'att1', status: 'completed', startedAt: 't0', expiresAt: 't1', submittedAt: 't2', correctCount: 3, totalQuestions: 4, scorePercent: 75 } })],
      page: 1, page_size: 25, total: 1
    })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('3/4 correctas')
    expect(wrapper.text()).toContain('75%')

    const btn = wrapper.find('.btn-primary')
    expect(btn.text()).toBe('Ver resultado')
    await btn.trigger('click')
    expect(push).toHaveBeenCalledWith('/user/attempts/att1/result')
  })

  it('shows a badge and no action button for an expired attempt', async () => {
    get.mockResolvedValue({
      quizzes: [quizRow({ attempt: { id: 'att1', status: 'expired', startedAt: 't0', expiresAt: 't1', submittedAt: null, correctCount: 0, totalQuestions: 4, scorePercent: 0 } })],
      page: 1, page_size: 25, total: 1
    })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.badge-orange').exists()).toBe(true)
    expect(wrapper.find('.btn-primary').exists()).toBe(false)
  })

  it('renders pagination controls driven by store.page/total/pageSize', async () => {
    get.mockResolvedValue({ quizzes: [quizRow()], page: 1, page_size: 1, total: 3 })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Página 1 de 3')
  })

  it('clicking Siguiente refetches the next page', async () => {
    get.mockResolvedValue({ quizzes: [quizRow()], page: 1, page_size: 1, total: 3 })
    const wrapper = mountView()
    await flushPromises()

    get.mockResolvedValue({ quizzes: [quizRow({ assignmentId: 'a2' })], page: 2, page_size: 1, total: 3 })
    const buttons = wrapper.findAll('.pagination button')
    await buttons[1].trigger('click')
    await flushPromises()

    const url = get.mock.calls[get.mock.calls.length - 1][0]
    expect(url).toContain('page=2')
  })

  it('logging out clears the usuario session and navigates to /user/login', async () => {
    get.mockResolvedValue({ quizzes: [], page: 1, page_size: 25, total: 0 })
    const pinia = createPinia()
    setActivePinia(pinia)
    useUserAuthStore().login('jwt', { id: 'u1', email: 'u@x.com', fullName: 'Uno', puntoDeVenta: 'Cerritos' })
    const wrapper = mount(UserQuizzesView, { global: { plugins: [pinia] } })
    await flushPromises()

    await wrapper.find('.btn-ghost').trigger('click')

    expect(useUserAuthStore().isLoggedIn).toBe(false)
    expect(push).toHaveBeenCalledWith('/user/login')
  })
})
