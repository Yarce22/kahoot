// PUNTOS_DE_VENTA — the fixed set of store values allowed on
// admins.punto_de_venta / users.punto_de_venta (see migration 009). Mirrored
// verbatim in client/src/lib/puntosDeVenta.js; there is no automated
// drift check between the two copies (accepted risk, see design doc D-tradeoffs).
export const PUNTOS_DE_VENTA = Object.freeze([
  'Cerritos',
  'Campestre',
  'Centenario',
  'Circunvalar',
  'Laureles'
])
