import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
const del = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ get, post, del, put: vi.fn(), patch: vi.fn() })
}))

const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', async (orig) => ({
  ...(await orig()),
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() })
}))

import QuizListView from '../src/views/admin/QuizListView.vue'
import { useAuthStore } from '../src/stores/auth.js'

function mountView(pinia) {
  return mount(QuizListView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

function mountAs(role) {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (role) useAuthStore().login('jwt', { id: role === 'superadmin' ? 's1' : 'a1', email: 'a@x.com', role })
  return mountView(pinia)
}

const ASSIGNABLE_QUIZ = { id: 'q1', title: 'Trivia', description: null, questionCount: 3, total_time_seconds: 600 }
const NOT_ASSIGNABLE_QUIZ = { id: 'q2', title: 'Live only', description: null, questionCount: 2, total_time_seconds: null }

describe('QuizListView — nav link', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset().mockResolvedValue([])
    post.mockReset()
    del.mockReset()
  })

  it('shows the Usuarios link for a plain admin (not superadmin-gated)', async () => {
    const wrapper = mountAs('admin')
    await flushPromises()

    const link = wrapper.find('a[href="/admin/users"]')
    expect(link.exists()).toBe(true)
  })

  it('shows the Usuarios link for a superadmin too', async () => {
    const wrapper = mountAs('superadmin')
    await flushPromises()

    expect(wrapper.find('a[href="/admin/users"]').exists()).toBe(true)
  })
})

describe('QuizListView — Asignar popup', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
    post.mockReset()
    del.mockReset()
  })

  it('shows guidance only for a quiz with no total_time_seconds — no fetch, no API call', async () => {
    get.mockResolvedValue([NOT_ASSIGNABLE_QUIZ])
    const wrapper = mountAs('admin')
    await flushPromises()

    get.mockClear()
    await wrapper.find('.btn-assign').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('no tiene tiempo asíncrono configurado')
    expect(wrapper.find('.assign-user-list').exists()).toBe(false)
    // The only GET call so far was the initial quiz list fetch; opening the
    // popup for a non-assignable quiz must not trigger a usuario fetch.
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('fetches active usuarios for an assignable quiz and posts the selected ids', async () => {
    get.mockResolvedValueOnce([ASSIGNABLE_QUIZ])
    const wrapper = mountAs('admin')
    await flushPromises()

    const usersPage = { users: [{ id: 'u1', full_name: 'Uno', email: 'u1@x.com' }], page: 1, page_size: 25, total: 1 }
    get.mockResolvedValueOnce(usersPage)
    await wrapper.find('.btn-assign').trigger('click')
    await flushPromises()

    const usersCallUrl = get.mock.calls.find(([url]) => url.startsWith('/api/users'))[0]
    expect(usersCallUrl).toContain('is_active=true')

    const checkbox = wrapper.find('.assign-user-row input[type="checkbox"]')
    expect(checkbox.exists()).toBe(true)
    await checkbox.setValue(true)

    post.mockResolvedValue({ created: [{ id: 'a1', userId: 'u1' }], skipped: [] })
    await wrapper.find('.assign-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/assignments', { quiz_id: 'q1', user_ids: ['u1'] })
    expect(wrapper.text()).toContain('1 asignado(s)')
  })

  it('renders skipped count in the result summary and leaves the popup open', async () => {
    get.mockResolvedValueOnce([ASSIGNABLE_QUIZ])
    const wrapper = mountAs('admin')
    await flushPromises()

    get.mockResolvedValueOnce({ users: [{ id: 'u1', full_name: 'Uno', email: 'u1@x.com' }], page: 1, page_size: 25, total: 1 })
    await wrapper.find('.btn-assign').trigger('click')
    await flushPromises()

    await wrapper.find('.assign-user-row input[type="checkbox"]').setValue(true)
    post.mockResolvedValue({ created: [], skipped: [{ userId: 'u1', reason: 'already_assigned' }] })
    await wrapper.find('.assign-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('0 asignado(s), 1 ya estaba(n) asignado(s)')
    // Popup stays open after a successful assign so the admin can read the result.
    expect(wrapper.find('.assign-overlay').exists()).toBe(true)
  })

  it('does not show the store filter for a non-superadmin', async () => {
    get.mockResolvedValueOnce([ASSIGNABLE_QUIZ])
    const wrapper = mountAs('admin')
    await flushPromises()

    get.mockResolvedValueOnce({ users: [], page: 1, page_size: 25, total: 0 })
    await wrapper.find('.btn-assign').trigger('click')
    await flushPromises()

    expect(wrapper.find('#assign-store-select').exists()).toBe(false)
  })

  it('shows the store filter for a superadmin', async () => {
    get.mockResolvedValueOnce([ASSIGNABLE_QUIZ])
    const wrapper = mountAs('superadmin')
    await flushPromises()

    get.mockResolvedValueOnce({ users: [], page: 1, page_size: 25, total: 0 })
    await wrapper.find('.btn-assign').trigger('click')
    await flushPromises()

    expect(wrapper.find('#assign-store-select').exists()).toBe(true)
  })
})
