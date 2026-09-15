import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PUNTOS_DE_VENTA } from '../src/lib/puntosDeVenta.js'

test('PUNTOS_DE_VENTA — exports exactly the 5 fixed store values, in order', () => {
  assert.deepEqual(PUNTOS_DE_VENTA, ['Cerritos', 'Campestre', 'Centenario', 'Circunvalar', 'Laureles'])
})

test('PUNTOS_DE_VENTA — is frozen so a caller cannot mutate the shared list', () => {
  assert.throws(() => PUNTOS_DE_VENTA.push('Otra'), TypeError)
})
