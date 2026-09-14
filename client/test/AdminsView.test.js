import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
const patch = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ get, post, patch, put: vi.fn(), del: vi.fn() })
}))

import AdminsView from '../src/views/admin/AdminsView.vue'
import { PUNTOS_DE_VENTA } from '../src/lib/puntosDeVenta.js'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(AdminsView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

describe('AdminsView — create form', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset().mockResolvedValue([])
    post.mockReset()
    patch.mockReset()
  })

  // POST /api/admins rejects a payload with no punto_de_venta (400), so a form
  // without this control can never create an admin at all.
  it('offers every allowed punto de venta as an option', async () => {
    const wrapper = mountView()
    await flushPromises()

    const select = wrapper.find('#punto-de-venta-select')
    expect(select.exists()).toBe(true)
    expect(select.findAll('option').map((o) => o.element.value).filter(Boolean))
      .toEqual([...PUNTOS_DE_VENTA])
  })

  it('sends the chosen punto de venta with the creation payload', async () => {
    post.mockResolvedValue({ id: 'new', email: 'n@x.com', role: 'admin', is_active: true, punto_de_venta: 'Laureles' })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('#email-input').setValue('n@x.com')
    await wrapper.find('#password-input').setValue('pw12345')
    await wrapper.find('#punto-de-venta-select').setValue('Laureles')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/admins', {
      email: 'n@x.com',
      password: 'pw12345',
      role: 'admin',
      punto_de_venta: 'Laureles'
    })
  })

  it('refuses to submit without a punto de venta and never hits the network', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('#email-input').setValue('n@x.com')
    await wrapper.find('#password-input').setValue('pw12345')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-msg').exists()).toBe(true)
  })
})
