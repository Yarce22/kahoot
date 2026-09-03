import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import ForgotPasswordView from '../src/views/ForgotPasswordView.vue'

const GENERIC_MESSAGE = 'Si ese email está registrado, te enviamos un enlace para restablecer tu contraseña.'

function mountView() {
  return mount(ForgotPasswordView, {
    global: { components: { RouterLink: { template: '<a><slot /></a>' } } }
  })
}

async function submitEmail(wrapper, email) {
  await wrapper.find('#email-input').setValue(email)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('ForgotPasswordView', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('shows the server generic confirmation message and hides the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: GENERIC_MESSAGE })
    }))

    const wrapper = mountView()
    await submitEmail(wrapper, 'admin@example.com')

    expect(wrapper.find('.success-msg').text()).toBe(GENERIC_MESSAGE)
    // The form is replaced so a user can't sit there re-submitting and
    // burning the endpoint's tight rate-limit budget.
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('renders IDENTICAL output for a registered and an unregistered email', async () => {
    // The anti-enumeration guarantee is end-to-end: the server answers 200
    // with the same message either way, and the view must not add any
    // distinguishing copy of its own on top of it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: GENERIC_MESSAGE })
    }))

    const registered = mountView()
    await submitEmail(registered, 'admin@example.com')

    const unknown = mountView()
    await submitEmail(unknown, 'nobody@example.com')

    expect(unknown.html()).toBe(registered.html())
  })

  it('requires an email before hitting the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountView()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('.error-msg').exists()).toBe(true)
    expect(wrapper.find('.success-msg').exists()).toBe(false)
  })

  it('does not claim success when the request itself is rejected', async () => {
    // A non-200 can only mean malformed input (400) or rate limiting (429) —
    // never "unknown email", which the server answers 200. So surfacing it
    // leaks nothing, and showing a fake confirmation instead would strand
    // the user waiting for an email that is never coming.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many requests' })
    }))

    const wrapper = mountView()
    await submitEmail(wrapper, 'admin@example.com')

    expect(wrapper.find('.success-msg').exists()).toBe(false)
    expect(wrapper.find('.error-msg').exists()).toBe(true)
  })

  it('reports a transport failure instead of silently doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const wrapper = mountView()
    await submitEmail(wrapper, 'admin@example.com')

    expect(wrapper.find('.error-msg').text()).toContain('servidor')
    expect(wrapper.find('.success-msg').exists()).toBe(false)
  })
})
