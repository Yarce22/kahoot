import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
const patch = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ get, post, patch, put: vi.fn(), del: vi.fn() })
}))

import { useUsersStore } from '../src/stores/users.js'

describe('users store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    get.mockReset()
    post.mockReset()
    patch.mockReset()
  })

  it('fetchUsers with no args hits /api/users with no query string', async () => {
    get.mockResolvedValue({ users: [], page: 1, page_size: 25, total: 0 })
    const store = useUsersStore()
    await store.fetchUsers()
    expect(get).toHaveBeenCalledWith('/api/users')
  })

  it('fetchUsers forwards page/q/is_active as query params', async () => {
    get.mockResolvedValue({ users: [], page: 2, page_size: 25, total: 0 })
    const store = useUsersStore()
    await store.fetchUsers({ page: 2, q: 'ana', is_active: true })
    const url = get.mock.calls[0][0]
    expect(url).toContain('/api/users?')
    expect(url).toContain('page=2')
    expect(url).toContain('q=ana')
    expect(url).toContain('is_active=true')
  })

  it('fetchUsers stores the paginated response shape', async () => {
    const users = [{ id: 'u1', email: 'u1@x.com', full_name: 'Uno', punto_de_venta: 'Laureles', is_active: true }]
    get.mockResolvedValue({ users, page: 1, page_size: 25, total: 1 })
    const store = useUsersStore()
    await store.fetchUsers()
    expect(store.users).toEqual(users)
    expect(store.page).toBe(1)
    expect(store.pageSize).toBe(25)
    expect(store.total).toBe(1)
  })

  it('createUser posts without punto_de_venta when omitted', async () => {
    post.mockResolvedValue({ id: 'new', email: 'n@x.com', full_name: 'Nuevo', is_active: true, punto_de_venta: 'Laureles' })
    const store = useUsersStore()
    await store.createUser({ full_name: 'Nuevo', email: 'n@x.com', password: 'pw123456' })
    expect(post).toHaveBeenCalledWith('/api/users', {
      full_name: 'Nuevo',
      email: 'n@x.com',
      password: 'pw123456'
    })
    expect(store.users[0].email).toBe('n@x.com')
  })

  it('createUser posts with punto_de_venta when provided', async () => {
    post.mockResolvedValue({ id: 'new', email: 'n@x.com', full_name: 'Nuevo', is_active: true, punto_de_venta: 'Cerritos' })
    const store = useUsersStore()
    await store.createUser({ full_name: 'Nuevo', email: 'n@x.com', password: 'pw123456', punto_de_venta: 'Cerritos' })
    expect(post).toHaveBeenCalledWith('/api/users', {
      full_name: 'Nuevo',
      email: 'n@x.com',
      password: 'pw123456',
      punto_de_venta: 'Cerritos'
    })
  })

  it('updateUser patches and merges the server response into the row', async () => {
    const store = useUsersStore()
    store.users = [{ id: 'u1', email: 'u1@x.com', full_name: 'Uno', is_active: true }]
    patch.mockResolvedValue({ id: 'u1', email: 'u1@x.com', full_name: 'Uno', is_active: false })
    await store.updateUser('u1', { is_active: false })
    expect(patch).toHaveBeenCalledWith('/api/users/u1', { is_active: false })
    expect(store.users[0].is_active).toBe(false)
  })

  it('surfaces fetch errors into store.error', async () => {
    get.mockRejectedValue(new Error('boom'))
    const store = useUsersStore()
    await store.fetchUsers()
    expect(store.error).toBe('boom')
  })
})
