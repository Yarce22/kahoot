import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

vi.mock('vue-router', async (orig) => ({
  ...(await orig()),
  useRoute: () => ({ params: { id: 'q1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() })
}))

import QuizSessionsView from '../src/views/admin/QuizSessionsView.vue'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(QuizSessionsView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

describe('QuizSessionsView', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation((url) =>
      Promise.resolve(url.startsWith('/api/attempts')
        ? { attempts: [{ id: 'att-1', status: 'completed', correctCount: 2, totalQuestions: 3, submittedAt: '2026-10-29T10:00:00Z', user: { fullName: 'Ana' } }] }
        : { sessions: [{ id: 's1', pin: '123456', playerCount: 3, endedAt: '2026-10-29T10:00:00Z' }] })
    )
  })

  it('lists assigned-exam attempts and hides live PIN sessions', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Ana')
    expect(wrapper.find('h1').text()).toBe('Historial')
    expect(wrapper.text()).not.toContain('Sesiones en vivo')
    expect(wrapper.text()).not.toContain('PIN')
    expect(get.mock.calls.some(([url]) => url.includes('/sessions'))).toBe(false)
  })
})
