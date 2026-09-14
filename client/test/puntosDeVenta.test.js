import { describe, it, expect } from 'vitest'
import { PUNTOS_DE_VENTA } from '../src/lib/puntosDeVenta.js'

// This list is the client half of the mirror documented in
// server/src/lib/puntosDeVenta.js and migration 009: same values, same order.
// There is no automated drift check across the repo boundary, so this test at
// least pins the client copy against accidental edits.
describe('PUNTOS_DE_VENTA (client mirror)', () => {
  it('exports exactly the 5 fixed store values, in order', () => {
    expect(PUNTOS_DE_VENTA).toEqual(['Cerritos', 'Campestre', 'Centenario', 'Circunvalar', 'Laureles'])
  })

  it('is frozen so a caller cannot mutate the shared list', () => {
    expect(() => PUNTOS_DE_VENTA.push('Otra')).toThrow(TypeError)
  })
})
