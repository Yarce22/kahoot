import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
const patch = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ get, post, patch, put: vi.fn(), del: vi.fn() })
}))

import UsersView from '../src/views/admin/UsersView.vue'
import { useAuthStore } from '../src/stores/auth.js'
import { PUNTOS_DE_VENTA } from '../src/lib/puntosDeVenta.js'

function mountView(pinia) {
  return mount(UsersView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

// mountAs — creates a fresh pinia, logs the given role into auth BEFORE
// mounting (mounting first would leave the view's auth.isSuperadmin read
// stuck on the pre-login default), then mounts UsersView on that same pinia.
function mountAs(role) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().login('jwt', { id: role === 'superadmin' ? 's1' : 'a1', email: 'a@x.com', role })
  return mountView(pinia)
}

function mountPlain() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mountView(pinia)
}

const PAGE_1 = { users: [], page: 1, page_size: 25, total: 0 }

describe('UsersView — create form', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset().mockResolvedValue(PAGE_1)
    post.mockReset()
    patch.mockReset()
  })

  // POST /api/users defaults punto_de_venta to the caller's own store when
  // omitted, and a non-superadmin has no client-side way to know its own
  // store — so the control must not even render for them.
  it('does not render the punto_de_venta control for a non-superadmin', async () => {
    const wrapper = mountAs('admin')
    await flushPromises()

    expect(wrapper.find('#punto-de-venta-select').exists()).toBe(false)
  })

  it('renders the punto_de_venta control for a superadmin', async () => {
    const wrapper = mountAs('superadmin')
    await flushPromises()

    const select = wrapper.find('#punto-de-venta-select')
    expect(select.exists()).toBe(true)
    expect(select.findAll('option').map((o) => o.element.value).filter(Boolean))
      .toEqual([...PUNTOS_DE_VENTA])
  })

  it('sends full_name/email/password without punto_de_venta for a non-superadmin', async () => {
    post.mockResolvedValue({ id: 'new', email: 'n@x.com', full_name: 'Nuevo', is_active: true, punto_de_venta: 'Laureles' })
    const wrapper = mountAs('admin')
    await flushPromises()

    await wrapper.find('#full-name-input').setValue('Nuevo')
    await wrapper.find('#email-input').setValue('n@x.com')
    await wrapper.find('#password-input').setValue('pw123456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/users', {
      full_name: 'Nuevo',
      email: 'n@x.com',
      password: 'pw123456'
    })
  })

  it('sends the chosen punto_de_venta for a superadmin', async () => {
    post.mockResolvedValue({ id: 'new', email: 'n@x.com', full_name: 'Nuevo', is_active: true, punto_de_venta: 'Cerritos' })
    const wrapper = mountAs('superadmin')
    await flushPromises()

    await wrapper.find('#full-name-input').setValue('Nuevo')
    await wrapper.find('#email-input').setValue('n@x.com')
    await wrapper.find('#password-input').setValue('pw123456')
    await wrapper.find('#punto-de-venta-select').setValue('Cerritos')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/users', {
      full_name: 'Nuevo',
      email: 'n@x.com',
      password: 'pw123456',
      punto_de_venta: 'Cerritos'
    })
  })

  it('refuses to submit a short password and never hits the network', async () => {
    const wrapper = mountAs('admin')
    await flushPromises()

    await wrapper.find('#full-name-input').setValue('Nuevo')
    await wrapper.find('#email-input').setValue('n@x.com')
    await wrapper.find('#password-input').setValue('short')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-msg').exists()).toBe(true)
  })
})

describe('UsersView — list and pagination', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
    post.mockReset()
    patch.mockReset()
  })

  const USER_A = { id: 'u1', email: 'u1@x.com', full_name: 'Usuario Uno', punto_de_venta: 'Cerritos', is_active: true }
  const USER_B = { id: 'u2', email: 'u2@x.com', full_name: 'Usuario Dos', punto_de_venta: 'Laureles', is_active: false }

  it('renders each user with name, email, store badge and active/inactive badge', async () => {
    get.mockResolvedValue({ users: [USER_A, USER_B], page: 1, page_size: 25, total: 2 })
    const wrapper = mountPlain()
    await flushPromises()

    const rows = wrapper.findAll('.user-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Usuario Uno')
    expect(rows[0].text()).toContain('u1@x.com')
    expect(rows[0].text()).toContain('Cerritos')
    expect(rows[1].find('.badge-inactive').exists()).toBe(true)
  })

  it('renders pagination controls driven by store.page/total/pageSize', async () => {
    get.mockResolvedValue({ users: [USER_A], page: 1, page_size: 1, total: 3 })
    const wrapper = mountPlain()
    await flushPromises()

    expect(wrapper.text()).toContain('Página 1 de 3')
  })

  it('clicking Siguiente refetches the next page', async () => {
    get.mockResolvedValue({ users: [USER_A], page: 1, page_size: 1, total: 3 })
    const wrapper = mountPlain()
    await flushPromises()

    get.mockResolvedValue({ users: [USER_B], page: 2, page_size: 1, total: 3 })
    const buttons = wrapper.findAll('.pagination button')
    await buttons[1].trigger('click')
    await flushPromises()

    const url = get.mock.calls[get.mock.calls.length - 1][0]
    expect(url).toContain('page=2')
  })

  it('deactivating an active user calls updateUser with is_active: false', async () => {
    get.mockResolvedValue({ users: [USER_A], page: 1, page_size: 25, total: 1 })
    patch.mockResolvedValue({ ...USER_A, is_active: false })
    const wrapper = mountPlain()
    await flushPromises()

    await wrapper.find('.btn-deactivate').trigger('click')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('/api/users/u1', { is_active: false })
  })

  it('activating an inactive user calls updateUser with is_active: true', async () => {
    get.mockResolvedValue({ users: [USER_B], page: 1, page_size: 25, total: 1 })
    patch.mockResolvedValue({ ...USER_B, is_active: true })
    const wrapper = mountPlain()
    await flushPromises()

    await wrapper.find('.btn-activate').trigger('click')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('/api/users/u2', { is_active: true })
  })
})

describe('UsersView — edit popup', () => {
  const USER_A = { id: 'u1', email: 'u1@x.com', full_name: 'Usuario Uno', punto_de_venta: 'Cerritos', is_active: true }

  beforeEach(() => {
    localStorage.clear()
    get.mockReset().mockResolvedValue({ users: [USER_A], page: 1, page_size: 25, total: 1 })
    post.mockReset()
    patch.mockReset()
  })

  it('opens pre-filled with the row\'s current name and store', async () => {
    const wrapper = mountAs('superadmin')
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')

    expect(wrapper.find('#edit-full-name-input').element.value).toBe('Usuario Uno')
    expect(wrapper.find('#edit-punto-de-venta-select').element.value).toBe('Cerritos')
  })

  // A non-superadmin can't move a usuario to another store — the server only
  // ever allows same-store writes for them — so the control must not render.
  it('does not render the punto_de_venta control for a non-superadmin', async () => {
    const wrapper = mountAs('admin')
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')

    expect(wrapper.find('#edit-punto-de-venta-select').exists()).toBe(false)
  })

  it('saving sends full_name and punto_de_venta for a superadmin, then closes the popup', async () => {
    patch.mockResolvedValue({ ...USER_A, full_name: 'Nombre Editado', punto_de_venta: 'Laureles' })
    const wrapper = mountAs('superadmin')
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')
    await wrapper.find('#edit-full-name-input').setValue('Nombre Editado')
    await wrapper.find('#edit-punto-de-venta-select').setValue('Laureles')
    await wrapper.find('.edit-popup .btn-primary').trigger('click')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('/api/users/u1', { full_name: 'Nombre Editado', punto_de_venta: 'Laureles' })
    expect(wrapper.find('.edit-overlay').exists()).toBe(false)
  })

  it('saving as a non-superadmin sends only full_name', async () => {
    patch.mockResolvedValue({ ...USER_A, full_name: 'Nombre Editado' })
    const wrapper = mountAs('admin')
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')
    await wrapper.find('#edit-full-name-input').setValue('Nombre Editado')
    await wrapper.find('.edit-popup .btn-primary').trigger('click')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('/api/users/u1', { full_name: 'Nombre Editado' })
  })

  it('refuses to save an emptied name and never hits the network', async () => {
    const wrapper = mountAs('superadmin')
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')
    await wrapper.find('#edit-full-name-input').setValue('   ')
    await wrapper.find('.edit-popup .btn-primary').trigger('click')
    await flushPromises()

    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.find('.edit-overlay').exists()).toBe(true)
  })

  it('Cancelar closes the popup without saving', async () => {
    const wrapper = mountAs('superadmin')
    await flushPromises()

    await wrapper.find('.btn-edit').trigger('click')
    await wrapper.find('.edit-popup .btn-ghost').trigger('click')

    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.find('.edit-overlay').exists()).toBe(false)
  })
})
