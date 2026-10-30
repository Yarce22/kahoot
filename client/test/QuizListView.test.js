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

  it('shows the Dashboard link to the progress dashboard', async () => {
    const wrapper = mountAs('admin')
    await flushPromises()

    expect(wrapper.find('a[href="/admin/dashboard"]').text()).toContain('Dashboard')
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

describe('QuizListView — Reactivar popup', () => {
  const ASSIGNMENTS = [
    { id: 'a1', user: { id: 'u1', fullName: 'Uno', email: 'u1@x.com' }, status: 'completed', cycle: 1 },
    { id: 'a2', user: { id: 'u2', fullName: 'Dos', email: 'u2@x.com' }, status: 'expired', cycle: 1 }
  ]

  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
    post.mockReset()
    del.mockReset()
  })

  async function openReactivate() {
    get.mockResolvedValueOnce([ASSIGNABLE_QUIZ])
    const wrapper = mountAs('admin')
    await flushPromises()
    get.mockResolvedValueOnce({ assignments: ASSIGNMENTS, page: 1, page_size: 100, total: 2 })
    await wrapper.find('.btn-reactivate').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('lists the quiz assignments instead of reactivating everyone at once', async () => {
    const wrapper = await openReactivate()

    expect(get).toHaveBeenLastCalledWith('/api/assignments?quiz_id=q1&page=1&page_size=100')
    expect(post).not.toHaveBeenCalled()
    const rows = wrapper.findAll('.reactivate-overlay .assign-user-list .assign-user-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Uno')
  })

  it('posts only the selected usuarios', async () => {
    const wrapper = await openReactivate()

    await wrapper.findAll('.reactivate-overlay .assign-user-list .assign-user-row input')[1].setValue(true)
    post.mockResolvedValue({ reactivated: 1, cycle: 2 })
    await wrapper.find('.reactivate-overlay .btn-primary').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/assignments/reactivate', { quiz_id: 'q1', user_ids: ['u2'] })
    expect(wrapper.text()).toContain('1 asignación(es) reactivada(s).')
  })

  it('disables submit until at least one usuario is selected, and "Seleccionar todos" selects every row', async () => {
    const wrapper = await openReactivate()
    const submit = wrapper.find('.reactivate-overlay .btn-primary')
    expect(submit.attributes('disabled')).toBeDefined()

    await wrapper.find('#reactivate-select-all').setValue(true)
    expect(submit.attributes('disabled')).toBeUndefined()
    post.mockResolvedValue({ reactivated: 2, cycle: 2 })
    await submit.trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/assignments/reactivate', { quiz_id: 'q1', user_ids: ['u1', 'u2'] })
  })

  it('ignores a late assignment fetch from a quiz whose popup was already replaced', async () => {
    const OTHER_QUIZ = { ...ASSIGNABLE_QUIZ, id: 'q3', title: 'Otro' }
    get.mockResolvedValueOnce([ASSIGNABLE_QUIZ, OTHER_QUIZ])
    const wrapper = mountAs('admin')
    await flushPromises()

    let resolveFirst
    get.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    const buttons = wrapper.findAll('.btn-reactivate')
    await buttons[0].trigger('click')
    get.mockResolvedValueOnce({ assignments: [ASSIGNMENTS[1]], page: 1, page_size: 100, total: 1 })
    await buttons[1].trigger('click')
    await flushPromises()
    resolveFirst({ assignments: ASSIGNMENTS, page: 1, page_size: 100, total: 2 })
    await flushPromises()

    const rows = wrapper.findAll('.reactivate-overlay .assign-user-list .assign-user-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Dos')
  })

  it('clears the selection after a successful reactivation even if the refresh fails', async () => {
    const wrapper = await openReactivate()

    await wrapper.find('#reactivate-select-all').setValue(true)
    post.mockResolvedValue({ reactivated: 2, cycle: 2 })
    get.mockRejectedValueOnce(new Error('network down'))
    await wrapper.find('.reactivate-overlay .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('2 asignación(es) reactivada(s).')
    expect(wrapper.find('.reactivate-overlay .btn-primary').attributes('disabled')).toBeDefined()
  })

  it('tells the admin when nothing was reactivated', async () => {
    const wrapper = await openReactivate()

    await wrapper.findAll('.reactivate-overlay .assign-user-list .assign-user-row input')[0].setValue(true)
    post.mockResolvedValue({ reactivated: 0, cycle: 2 })
    get.mockResolvedValueOnce({ assignments: ASSIGNMENTS, page: 1, page_size: 100, total: 2 })
    await wrapper.find('.reactivate-overlay .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('No se reactivó ninguna asignación.')
  })
})
