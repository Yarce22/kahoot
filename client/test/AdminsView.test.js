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
      name: null,
      email: 'n@x.com',
      password: 'pw12345',
      role: 'admin',
      punto_de_venta: 'Laureles'
    })
  })

  it('sends a trimmed name when the create form name field is filled', async () => {
    post.mockResolvedValue({ id: 'new', email: 'n@x.com', role: 'admin', is_active: true, punto_de_venta: 'Laureles', name: 'Nombre Apellido' })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('#name-input').setValue('  Nombre Apellido  ')
    await wrapper.find('#email-input').setValue('n@x.com')
    await wrapper.find('#password-input').setValue('pw12345')
    await wrapper.find('#punto-de-venta-select').setValue('Laureles')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(post.mock.calls[0][1].name).toBe('Nombre Apellido')
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

describe('AdminsView — admin list and edit popup', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
    post.mockReset()
    patch.mockReset()
  })

  const ADMIN_NO_NAME = { id: 'a1', email: 'a1@x.com', role: 'admin', is_active: true, punto_de_venta: 'Cerritos', name: null }
  const ADMIN_WITH_NAME = { id: 'a2', email: 'a2@x.com', role: 'superadmin', is_active: true, punto_de_venta: 'Laureles', name: 'Nombre Apellido' }

  // Regression guard for the existing behaviour: a row without a name still
  // shows just the email, exactly like before this field existed.
  it('shows email only for a row without a name, and name + email for a row with one', async () => {
    get.mockResolvedValue([ADMIN_NO_NAME, ADMIN_WITH_NAME])
    const wrapper = mountView()
    await flushPromises()

    const rows = wrapper.findAll('.admin-row')
    expect(rows[0].find('.admin-name').exists()).toBe(false)
    expect(rows[0].text()).toContain('a1@x.com')

    expect(rows[1].find('.admin-name').text()).toBe('Nombre Apellido')
    expect(rows[1].text()).toContain('a2@x.com')
  })

  // The role-toggle buttons are gone — replaced by a single Editar button.
  it('no longer renders the role-toggle buttons', async () => {
    get.mockResolvedValue([ADMIN_NO_NAME])
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.btn-promote').exists()).toBe(false)
    expect(wrapper.find('.btn-demote').exists()).toBe(false)
    expect(wrapper.find('.btn-edit').exists()).toBe(true)
  })

  it('opens the edit popup pre-filled with the admin current name, role and punto_de_venta', async () => {
    get.mockResolvedValue([ADMIN_WITH_NAME])
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')
    await flushPromises()

    expect(wrapper.find('#edit-name-input').element.value).toBe('Nombre Apellido')
    expect(wrapper.find('#edit-role-select').element.value).toBe('superadmin')
    expect(wrapper.find('#edit-punto-de-venta-select').element.value).toBe('Laureles')
  })

  it('saving calls updateAdmin with the edited fields and closes the popup', async () => {
    get.mockResolvedValue([ADMIN_WITH_NAME])
    patch.mockResolvedValue({ ...ADMIN_WITH_NAME, name: 'Otro Nombre', role: 'admin', punto_de_venta: 'Cerritos' })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')
    await flushPromises()

    await wrapper.find('#edit-name-input').setValue('Otro Nombre')
    await wrapper.find('#edit-role-select').setValue('admin')
    await wrapper.find('#edit-punto-de-venta-select').setValue('Cerritos')

    const saveButtons = wrapper.findAll('.edit-actions button')
    await saveButtons[1].trigger('click')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('/api/admins/a2', {
      name: 'Otro Nombre',
      role: 'admin',
      punto_de_venta: 'Cerritos'
    })
    expect(wrapper.find('.edit-overlay').exists()).toBe(false)
  })
})
