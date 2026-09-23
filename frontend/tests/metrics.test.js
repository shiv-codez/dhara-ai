import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  computeMetrics,
  projectToMetric,
  pointToSegmentDist,
  computeBoundaryOffset,
} from '../src/lib/metrics.js'

const poly = (coords, props = {}) => ({
  type: 'Feature',
  properties: props,
  geometry: {
    type: 'Polygon',
    coordinates: [coords],
  },
})

test('projectToMetric: computes local metric coordinates relative to origin', () => {
  const center = [75.0, 26.0]
  const [x0, y0] = projectToMetric([75.0, 26.0], center)
  assert.equal(Math.abs(x0), 0)
  assert.equal(Math.abs(y0), 0)

  // 1 degree north is ~111.32 km
  const [x1, y1] = projectToMetric([75.0, 27.0], center)
  assert.ok(Math.abs(y1 - 111319.49) < 10)
})

test('pointToSegmentDist: computes perpendicular and endpoint distances', () => {
  // Point (0, 5) to segment (0, 0)-(10, 0) -> distance is 5
  assert.equal(pointToSegmentDist(0, 5, 0, 0, 10, 0), 5)
  assert.equal(pointToSegmentDist(5, 5, 0, 0, 10, 0), 5)
  assert.equal(pointToSegmentDist(-3, 4, 0, 0, 10, 0), 5) // hypot(-3, 4) = 5
})

test('computeMetrics: perfect match gives 1.0 precision, recall, and F1', () => {
  const p1 = poly([
    [75.0, 26.0],
    [75.0002, 26.0],
    [75.0002, 26.0002],
    [75.0, 26.0002],
    [75.0, 26.0],
  ])

  const pred = { type: 'FeatureCollection', features: [p1] }
  const gt = { type: 'FeatureCollection', features: [p1] }

  const res = computeMetrics(pred, gt, 0.5)
  assert.ok(res)
  assert.equal(res.summary.tp, 1)
  assert.equal(res.summary.fp, 0)
  assert.equal(res.summary.fn, 0)
  assert.equal(res.summary.precision, 1.0)
  assert.equal(res.summary.recall, 1.0)
  assert.equal(res.summary.f1, 1.0)
  assert.equal(res.summary.mean_matched_iou, 1.0)
  assert.equal(res.summary.boundary_offset.mean_m, 0)
  assert.equal(res.layers.tp.features.length, 1)
  assert.equal(res.layers.fp.features.length, 0)
  assert.equal(res.layers.fn.features.length, 0)
})

test('computeMetrics: disjoint polygons yield 0 TP, 1 FP, 1 FN', () => {
  const pPred = poly([
    [75.0, 26.0],
    [75.0001, 26.0],
    [75.0001, 26.0001],
    [75.0, 26.0001],
    [75.0, 26.0],
  ])
  const pGt = poly([
    [75.001, 26.001],
    [75.0011, 26.001],
    [75.0011, 26.0011],
    [75.001, 26.0011],
    [75.001, 26.001],
  ])

  const pred = { type: 'FeatureCollection', features: [pPred] }
  const gt = { type: 'FeatureCollection', features: [pGt] }

  const res = computeMetrics(pred, gt, 0.5)
  assert.ok(res)
  assert.equal(res.summary.tp, 0)
  assert.equal(res.summary.fp, 1)
  assert.equal(res.summary.fn, 1)
  assert.equal(res.summary.precision, 0.0)
  assert.equal(res.summary.recall, 0.0)
  assert.equal(res.summary.f1, 0.0)
  assert.equal(res.layers.tp.features.length, 0)
  assert.equal(res.layers.fp.features.length, 1)
  assert.equal(res.layers.fn.features.length, 1)
})

test('computeMetrics: evaluation on real village_tiled reference data fixture', () => {
  const bldgPath = path.resolve('public/data/village_tiled/buildings.geojson')
  const refPath = path.resolve('public/data/village_tiled/reference_buildings.geojson')

  const predFc = JSON.parse(fs.readFileSync(bldgPath, 'utf8'))
  const gtFc = JSON.parse(fs.readFileSync(refPath, 'utf8'))

  const res = computeMetrics(predFc, gtFc, 0.5)
  assert.ok(res)
  assert.equal(res.summary.n_pred, predFc.features.length) // 75 candidate buildings
  assert.equal(res.summary.n_gt, gtFc.features.length)     // 55 ground-truth buildings
  assert.ok(res.summary.tp > 0)
  assert.ok(res.summary.precision > 0 && res.summary.precision <= 1.0)
  assert.ok(res.summary.recall > 0 && res.summary.recall <= 1.0)
  assert.ok(res.summary.f1 > 0 && res.summary.f1 <= 1.0)
  assert.ok(res.summary.mean_matched_iou >= 0.5)
  assert.ok(res.summary.boundary_offset.mean_m >= 0)
  assert.ok(res.summary.boundary_offset.p90_m >= 0)

  // Total classified features must match pred and gt totals
  assert.equal(res.layers.tp.features.length + res.layers.fp.features.length, res.summary.n_pred)
  assert.equal(res.layers.tp.features.length + res.layers.fn.features.length, res.summary.n_gt)
})
