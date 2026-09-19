import test from 'node:test'
import assert from 'node:assert/strict'
import { overlapsFor, resolveOverlaps, areaM2 } from '../src/lib/geo.js'

const sq = (id, x, y, s = 0.0001) => ({
  type: 'Feature',
  properties: { parcel_id: id },
  geometry: { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] },
})

test('no overlap for touching parcels', () => {
  const a = sq('A', 75.0, 26.0), b = sq('B', 75.0001, 26.0)
  assert.equal(overlapsFor(a, [a, b]).length, 0)
})

test('dragging a vertex into a neighbour is detected', () => {
  const a = sq('A', 75.0, 26.0), b = sq('B', 75.0001, 26.0)
  const moved = sq('A', 75.0, 26.0, 0.00012) // grew 2.0e-5 deg (~2 m) into B
  const ov = overlapsFor(moved, [moved, b])
  assert.equal(ov.length, 1)
  assert.equal(ov[0].with, 'B')
  assert.ok(ov[0].area > 5)
})

test('auto-resolve removes the overlap', () => {
  const b = sq('B', 75.0001, 26.0)
  const moved = sq('A', 75.0, 26.0, 0.00012)
  const ov = overlapsFor(moved, [moved, b])
  const fixed = { ...moved, geometry: resolveOverlaps(moved, ov, [moved, b]) }
  assert.equal(overlapsFor(fixed, [fixed, b]).length, 0)
  assert.ok(areaM2(fixed) < areaM2(moved))
})
