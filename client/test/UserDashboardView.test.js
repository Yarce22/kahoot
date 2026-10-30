import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useUserApi.js', () => ({
  useUserApi: () => ({ get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

import UserDashboardView from '../src/views/user/UserDashboardView.vue'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(UserDashboardView, {
    global: {
      plugins: [pinia],
      components: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } }
    }
  })
}

const q = (o = {}) => ({
  assignmentId: 'a1', quizId: 'q1', title: 'Seguridad', status: 'pending', cycle: 1,
  attemptStatus: null, scorePercent: null, submittedAt: null, ...o
})
const progress = (o = {}) => ({
  assigned: 4, completed: 3, completionPercent: 75, averageScore: 88,
  quizzes: [
    q({ status: 'completed', attemptId: 'att-1', attemptStatus: 'completed', scorePercent: 90 }),
    q({ assignmentId: 'a2', title: 'Higiene' }),
    q({ assignmentId: 'a3', title: 'Caja', attemptStatus: 'in_progress' }),
    q({ assignmentId: 'a4', title: 'Frío', attemptStatus: 'expired' })
  ],
  ...o
})

describe('UserDashboardView', () => {
  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
  })

  it('renders totals, progress bar, average and quiz rows', async () => {
    get.mockResolvedValue(progress())
    const w = mountView()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/api/user/progress')
    expect(w.find('[data-testid="completed"]').text()).toBe('3/4')
    expect(w.find('[data-testid="percent"]').text()).toBe('75%')
    expect(w.find('[data-testid="average"]').text()).toBe('88%')
    const bar = w.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('75')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('100')
    const t = w.text()
    for (const s of ['Seguridad', 'Completado', 'Pendiente', 'En progreso', 'Vencido']) expect(t).toContain(s)
    expect(w.find('[data-testid="score-a1"]').text()).toBe('90%')
    // Open quizzes live in "Por hacer" without a score; only completed ones show one.
    expect(w.find('[data-testid="score-a2"]').exists()).toBe(false)
  })

  it('shows a dash when the average is null', async () => {
    get.mockResolvedValue(progress({ averageScore: null, completed: 0, completionPercent: 0 }))
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-testid="average"]').text()).toBe('—')
  })

  it('shows the empty state', async () => {
    get.mockResolvedValue(progress({ assigned: 0, completed: 0, completionPercent: 0, averageScore: null, quizzes: [] }))
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('No tenés exámenes asignados.')
  })

  it('shows the error state', async () => {
    get.mockRejectedValue(new Error('boom'))
    const w = mountView()
    await flushPromises()
    expect(w.find('.error-msg').text()).toContain('boom')
  })

  it('shows the loading state', () => {
    get.mockReturnValue(new Promise(() => {}))
    expect(mountView().text()).toContain('Cargando…')
  })

  it('links only completed attempts to their result', async () => {
    get.mockResolvedValue(progress({ quizzes: [
      q({ status: 'completed', attemptId: 'att-1', attemptStatus: 'completed', scorePercent: 90 }),
      q({ assignmentId: 'a2', attemptId: 'att-2', attemptStatus: 'in_progress' }),
      q({ assignmentId: 'a3', attemptId: 'att-3', attemptStatus: 'expired' }),
      q({ assignmentId: 'a4' }),
      q({ assignmentId: 'a5', status: 'completed', attemptStatus: 'completed' })
    ] }))
    const w = mountView()
    await flushPromises()
    const links = w.findAll('a[href^="/user/attempts/"]')
    expect(links).toHaveLength(1)
    expect(links[0].attributes('href')).toBe('/user/attempts/att-1/result')
    expect(links[0].text()).toContain('Ver resultado')
  })

  it('offers to start or continue open quizzes and explains expired ones', async () => {
    get.mockResolvedValue(progress())
    const w = mountView()
    await flushPromises()
    expect(w.find('a[href="/user/quizzes/a2/attempt"]').text()).toBe('Comenzar')
    expect(w.find('a[href="/user/quizzes/a3/attempt"]').text()).toBe('Continuar')
    expect(w.find('a[href="/user/quizzes/a4/attempt"]').exists()).toBe(false)
    expect(w.text()).toContain('Te falta 1 examen, 1 vencido.')
  })

  it('links back to the quiz list', async () => {
    get.mockResolvedValue(progress())
    const w = mountView()
    await flushPromises()
    expect(w.find('a[href="/user/quizzes"]').text()).toContain('Volver a mis exámenes')
  })
})
