import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

import UserLoginView from '../src/views/user/UserLoginView.vue'
import { useUserAuthStore } from '../src/stores/userAuth.js'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(UserLoginView, { global: { plugins: [pinia] } })
}

async function submitCredentials(wrapper, email, password) {
  await wrapper.find('#email-input').setValue(email)
  await wrapper.find('#password-input').setValue(password)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('UserLoginView', () => {
  beforeEach(() => {
    localStorage.clear()
    push.mockClear()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('logs in and navigates to /user/quizzes on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        token: 'jwt-ok',
        user: { id: 'u1', email: 'u@x.com', fullName: 'Usuario Uno', puntoDeVenta: 'Cerritos' }
      })
    }))

    const wrapper = mountView()
    await submitCredentials(wrapper, 'u@x.com', 'secret')

    expect(useUserAuthStore().token).toBe('jwt-ok')
    expect(useUserAuthStore().user).toEqual({ id: 'u1', email: 'u@x.com', fullName: 'Usuario Uno', puntoDeVenta: 'Cerritos' })
    expect(push).toHaveBeenCalledWith('/user/quizzes')
  })

  it('posts to POST /api/user/login, not the admin login route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 't', user: { id: 'u1', email: 'u@x.com', fullName: 'U', puntoDeVenta: 'Cerritos' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountView()
    await submitCredentials(wrapper, 'u@x.com', 'secret')

    expect(fetchMock.mock.calls[0][0]).toContain('/api/user/login')
  })

  // Same anti-enumeration shape as AdminLoginView's 401 handling: unknown
  // email, wrong password, and a deactivated account all collapse into the
  // identical 401 server-side.
  it('shows an error and does not navigate on wrong credentials (401)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))

    const wrapper = mountView()
    await submitCredentials(wrapper, 'u@x.com', 'wrong')

    expect(wrapper.find('.error-msg').text()).toContain('incorrectos')
    expect(useUserAuthStore().isLoggedIn).toBe(false)
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
