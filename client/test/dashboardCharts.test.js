import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusStackBar from '../src/components/dashboard/StatusStackBar.vue'
import HBarChart from '../src/components/dashboard/HBarChart.vue'

describe('StatusStackBar', () => {
  const counts = { Completado: 5, 'En progreso': 3, Vencido: 0, Pendiente: 2 }

  it('renders only non-zero segments, proportional, with tooltips', () => {
    const w = mount(StatusStackBar, { props: { counts } })
    const segs = w.findAll('.seg')
    expect(segs).toHaveLength(3)
    expect(segs[0].attributes('title')).toBe('Completado: 5 (50%)')
    expect(segs[0].attributes('style')).toContain('flex: 5')
    expect(segs.map((s) => s.attributes('title')).join()).not.toContain('Vencido')
  })

  it('always lists all four statuses in the legend, zeros included', () => {
    const w = mount(StatusStackBar, { props: { counts } })
    const items = w.findAll('.legend li')
    expect(items).toHaveLength(4)
    expect(items[2].text()).toContain('Vencido')
    expect(items[2].text()).toContain('0')
    expect(items[0].text()).toContain('Completado')
    expect(items[0].text()).toContain('5')
    expect(items[0].text()).toContain('50%')
  })

  it('exposes an img role with a summarizing aria-label', () => {
    const w = mount(StatusStackBar, { props: { counts } })
    const img = w.find('[role="img"]')
    expect(img.attributes('aria-label')).toContain('Completado: 5')
    expect(img.attributes('aria-label')).toContain('Vencido: 0')
  })

  it('renders no segments when everything is zero', () => {
    const w = mount(StatusStackBar, { props: { counts: { Completado: 0, 'En progreso': 0, Vencido: 0, Pendiente: 0 } } })
    expect(w.findAll('.seg')).toHaveLength(0)
    expect(w.findAll('.legend li')).toHaveLength(4)
  })
})

describe('HBarChart', () => {
  const items = [
    { key: 'a', label: 'Seguridad', value: 75, caption: '6/8 · prom. 80%' },
    { key: 'b', label: 'Higiene', value: 0, caption: '0/2 · prom. —' }
  ]

  it('renders a row per item with label, value text and caption', () => {
    const w = mount(HBarChart, { props: { items, title: 'Avance por examen' } })
    const rows = w.findAll('.row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Seguridad')
    expect(rows[0].text()).toContain('75%')
    expect(rows[0].text()).toContain('6/8 · prom. 80%')
    expect(rows[0].find('.label').attributes('title')).toBe('Seguridad')
    expect(rows[0].attributes('title')).toContain('Seguridad')
  })

  it('sets fill width and progressbar aria attributes', () => {
    const w = mount(HBarChart, { props: { items, title: 'Avance por examen' } })
    const bar = w.findAll('[role="progressbar"]')[0]
    expect(bar.attributes('aria-valuenow')).toBe('75')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('100')
    expect(bar.attributes('aria-label')).toContain('Seguridad')
    expect(bar.find('.fill').attributes('style')).toContain('width: 75%')
  })
})
