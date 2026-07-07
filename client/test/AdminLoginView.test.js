import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import AdminLoginView from '../src/views/admin/AdminLoginView.vue'
import { useAuthStore } from '../src/stores/auth.js'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(AdminLoginView, { global: { plugins: [pinia] } })
}

async function submitCredentials(wrapper, email, password) {
  await wrapper.find('#email-input').setValue(email)
  await wrapper.find('#password-input').setValue(password)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('AdminLoginView', () => {
  beforeEach(() => {
    localStorage.clear()
    push.mockClear()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('logs in and navigates to quizzes on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'jwt-ok', admin: { id: 'a1', email: 'a@x.com' } })
    }))

    const wrapper = mountView()
    await submitCredentials(wrapper, 'a@x.com', 'secret')

    expect(useAuthStore().token).toBe('jwt-ok')
    expect(useAuthStore().admin).toEqual({ id: 'a1', email: 'a@x.com' })
    expect(push).toHaveBeenCalledWith('/admin/quizzes')
  })

  it('shows an error and does not navigate on wrong credentials (401)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))

    const wrapper = mountView()
    await submitCredentials(wrapper, 'a@x.com', 'wrong')

    expect(wrapper.find('.error-msg').text()).toContain('incorrectos')
    expect(useAuthStore().isLoggedIn).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('validates required fields without hitting the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountView()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('.error-msg').exists()).toBe(true)
  })
})
