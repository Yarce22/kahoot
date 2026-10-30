import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

import AdminDashboardView from '../src/views/admin/AdminDashboardView.vue'
import { useAuthStore } from '../src/stores/auth.js'

function mountAs(role = 'admin') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().login('jwt', { id: 'a1', email: 'a@x.com', role })
  return mount(AdminDashboardView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

const quiz = (o = {}) => ({
  assignmentId: 'as1', quizId: 'q1', quizTitle: 'Seguridad', status: 'pending',
  cycle: 1, attemptStatus: null, scorePercent: null, submittedAt: null, ...o
})
const user = (o = {}) => ({
  userId: 'u1', fullName: 'Ana Pérez', email: 'ana@x.com', puntoDeVenta: 'Cerritos',
  assigned: 4, completed: 1, completionPercent: 25, averageScore: 80,
  quizzes: [quiz({ status: 'completed', attemptStatus: 'completed', scorePercent: 80 })],
  ...o
})

describe('AdminDashboardView', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
  })

  it('renders the summary and per-usuario progress', async () => {
    get.mockResolvedValue({ users: [user(), user({ userId: 'u2', fullName: 'Beto', assigned: 2, completed: 2, completionPercent: 100, averageScore: null, quizzes: [] })] })
    const w = mountAs()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/api/dashboard/progress')
    expect(w.text()).toContain('Ana Pérez')
    expect(w.text()).toContain('Cerritos')
    expect(w.text()).toContain('1/4')
    expect(w.find('[data-testid="overall"]').text()).toBe('3/6')
    expect(w.find('[data-testid="total-users"]').text()).toBe('2')
    const bar = w.findAll('[role="progressbar"]')[0]
    expect(bar.attributes('aria-valuenow')).toBe('25')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('100')
    expect(w.find('[data-testid="avg-u1"]').text()).toBe('80%')
  })

  // The two percentages sit side by side, so each needs its own visible label.
  it('labels the completion and average percentages', async () => {
    get.mockResolvedValue({ users: [user()] })
    const w = mountAs()
    await flushPromises()
    const row = w.find('.dash-user-head')
    expect(row.find('[data-testid="completion-u1"]').text()).toBe('Avance 25%')
    expect(row.find('[data-testid="average-u1"]').text()).toBe('Promedio 80%')
  })

  it('shows a dash when the average score is null', async () => {
    get.mockResolvedValue({ users: [user({ averageScore: null })] })
    const w = mountAs()
    await flushPromises()
    expect(w.find('[data-testid="avg-u1"]').text()).toBe('—')
  })

  it('expands a usuario to list quizzes with Spanish status and score', async () => {
    get.mockResolvedValue({ users: [user({ quizzes: [
      quiz({ status: 'completed', attemptStatus: 'completed', scorePercent: 80 }),
      quiz({ assignmentId: 'as2', quizTitle: 'Higiene' }),
      quiz({ assignmentId: 'as3', quizTitle: 'Caja', attemptStatus: 'in_progress' }),
      quiz({ assignmentId: 'as4', quizTitle: 'Frío', attemptStatus: 'expired' })
    ] })] })
    const w = mountAs()
    await flushPromises()
    expect(w.text()).not.toContain('Higiene')
    await w.find('[data-testid="toggle-u1"]').trigger('click')
    const text = w.text()
    for (const s of ['Seguridad', 'Completado', 'Pendiente', 'En progreso', 'Vencido']) expect(text).toContain(s)
    expect(w.find('[data-testid="score-as1"]').text()).toBe('80%')
    expect(w.find('[data-testid="score-as2"]').text()).toBe('—')
  })

  it('shows the empty state', async () => {
    get.mockResolvedValue({ users: [] })
    const w = mountAs()
    await flushPromises()
    expect(w.text()).toContain('No hay exámenes asignados.')
  })

  it('shows the error state', async () => {
    get.mockRejectedValue(new Error('boom'))
    const w = mountAs()
    await flushPromises()
    expect(w.find('.error-msg').text()).toContain('boom')
  })

  it('shows the loading state', () => {
    get.mockReturnValue(new Promise(() => {}))
    expect(mountAs().text()).toContain('Cargando…')
  })

  it('superadmin gets a store filter that refetches; plain admin does not', async () => {
    get.mockResolvedValue({ users: [] })
    const sa = mountAs('superadmin')
    await flushPromises()
    const select = sa.find('select')
    expect(select.exists()).toBe(true)
    expect(select.text()).toContain('Todos')
    await select.setValue('Laureles')
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/api/dashboard/progress?punto_de_venta=Laureles')
    await select.setValue('')
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/api/dashboard/progress')

    const admin = mountAs('admin')
    await flushPromises()
    expect(admin.find('select').exists()).toBe(false)
  })

  it('applies only the latest response when filter loads overlap out of order', async () => {
    let resolveFirst
    get.mockResolvedValueOnce({ users: [] })
    const sa = mountAs('superadmin')
    await flushPromises()
    get.mockReturnValueOnce(new Promise((r) => { resolveFirst = r }))
    get.mockResolvedValueOnce({ users: [user({ userId: 'u2', fullName: 'Beto Nuevo' })] })
    const select = sa.find('select')
    await select.setValue('Laureles')
    await select.setValue('Cerritos')
    await flushPromises()
    expect(sa.text()).toContain('Beto Nuevo')
    resolveFirst({ users: [user({ userId: 'u3', fullName: 'Viejo Lento' })] })
    await flushPromises()
    expect(sa.text()).toContain('Beto Nuevo')
    expect(sa.text()).not.toContain('Viejo Lento')
  })

  it('clears the previous rows when a refetch fails', async () => {
    get.mockResolvedValueOnce({ users: [user()] })
    const sa = mountAs('superadmin')
    await flushPromises()
    expect(sa.text()).toContain('Ana Pérez')
    get.mockRejectedValueOnce(new Error('boom'))
    await sa.find('select').setValue('Laureles')
    await flushPromises()
    expect(sa.find('.error-msg').text()).toContain('boom')
    expect(sa.text()).not.toContain('Ana Pérez')
  })

  it('links back to the quiz list', async () => {
    get.mockResolvedValue({ users: [] })
    const w = mountAs()
    await flushPromises()
    expect(w.find('a[href="/admin/quizzes"]').text()).toContain('Volver')
  })
})
