import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { push, route } = vi.hoisted(() => ({
  push: vi.fn(),
  route: { query: {} }
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => route
}))

import ResetPasswordView from '../src/views/ResetPasswordView.vue'

function mountView(query = { token: 'a-valid-token' }) {
  route.query = query
  return mount(ResetPasswordView, {
    global: { components: { RouterLink: { template: '<a><slot /></a>' } } }
  })
}

async function submitPasswords(wrapper, password, confirmation) {
  await wrapper.find('#password-input').setValue(password)
  await wrapper.find('#confirm-password-input').setValue(confirmation)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('ResetPasswordView', () => {
  beforeEach(() => {
    push.mockClear()
    vi.unstubAllGlobals()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('redirects to login with a success flag once the password is reset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Contraseña actualizada correctamente' })
    }))

    const wrapper = mountView()
    await submitPasswords(wrapper, 'new-password-123', 'new-password-123')

    // The success banner lives on the login screen, reached via ?reset=success.
    expect(push).toHaveBeenCalledWith({ path: '/admin/login', query: { reset: 'success' } })
    expect(wrapper.find('.error-msg').exists()).toBe(false)
  })

  it('blocks submission when the two passwords do not match', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountView()
    await submitPasswords(wrapper, 'new-password-123', 'new-password-124')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('.error-msg').text()).toContain('no coinciden')
    expect(push).not.toHaveBeenCalled()
  })

  it('blocks submission when either field is empty', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountView()
    await submitPasswords(wrapper, 'new-password-123', '')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('.error-msg').exists()).toBe(true)
  })

  it('offers no form at all without a token, pointing back at forgot-password', async () => {
    const wrapper = mountView({})

    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.error-msg').text()).toContain('no es válido')
  })

  it('keeps the user on the page and shows the server reason when the token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid or expired reset link' })
    }))

    const wrapper = mountView()
    await submitPasswords(wrapper, 'new-password-123', 'new-password-123')

    expect(wrapper.find('.error-msg').text()).toBe('Invalid or expired reset link')
    expect(push).not.toHaveBeenCalled()
  })

  it('reports a transport failure instead of silently doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const wrapper = mountView()
    await submitPasswords(wrapper, 'new-password-123', 'new-password-123')

    expect(wrapper.find('.error-msg').text()).toContain('servidor')
    expect(push).not.toHaveBeenCalled()
  })
})
