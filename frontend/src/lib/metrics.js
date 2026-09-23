/**
 * In-browser ground truth accuracy and boundary offset metrics engine.
 * Computes instance-level Precision, Recall, F1 (IoU >= 0.50), mean matched IoU,
 * and boundary offset distances in metres matching backend/dhara/metrics.py.
 */
import intersect from '@turf/intersect'
import area from '@turf/area'
import bbox from '@turf/bbox'
import { featureCollection } from '@turf/helpers'

const R_EARTH = 6378137.0
const DEG_TO_RAD = Math.PI / 180.0

export const asFeature = (f) => (f.type === 'Feature' ? f : { type: 'Feature', properties: {}, geometry: f })

export const bboxHit = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1])

/**
 * Projects WGS84 coordinate [lon, lat] to local metric planar coordinates [x, y] in metres
 * relative to reference center [lon0, lat0].
 */
export function projectToMetric(coord, center) {
  const [lon, lat] = coord
  const [lon0, lat0] = center
  const cosLat0 = Math.cos(lat0 * DEG_TO_RAD)
  const x = (lon - lon0) * DEG_TO_RAD * R_EARTH * cosLat0
  const y = (lat - lat0) * DEG_TO_RAD * R_EARTH
  return [x, y]
}

/**
 * Calculates Euclidean distance from 2D point (px, py) to line segment (ax, ay)-(bx, by).
 */
export function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay)
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = ax + t * dx
  const projY = ay + t * dy
  return Math.hypot(px - projX, py - projY)
}

/**
 * Computes boundary offset distances in metres from predicted polygon perimeters to GT boundaries.
 */
export function computeBoundaryOffset(predFeatures, gtFeatures, stepM = 0.5) {
  if (!predFeatures.length || !gtFeatures.length) {
    return { mean_m: 0, median_m: 0, p90_m: 0, rmse_m: 0 }
  }

  // Find reference center point from first coordinate
  const firstCoord =
    gtFeatures[0].geometry?.coordinates?.[0]?.[0] ||
    predFeatures[0].geometry?.coordinates?.[0]?.[0] ||
    [0, 0]
  const center = [firstCoord[0], firstCoord[1]]

  // Extract all GT boundary segments in metric space
  const gtSegments = []
  for (const f of gtFeatures) {
    const geom = f.geometry
    if (!geom) continue
    const rings =
      geom.type === 'Polygon'
        ? geom.coordinates
        : geom.type === 'MultiPolygon'
        ? geom.coordinates.flat(1)
        : []
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = projectToMetric(ring[i], center)
        const [bx, by] = projectToMetric(ring[i + 1], center)
        gtSegments.push([ax, ay, bx, by])
      }
    }
  }

  if (!gtSegments.length) {
    return { mean_m: 0, median_m: 0, p90_m: 0, rmse_m: 0 }
  }

  const distances = []

  // Sample points along predicted polygon boundaries
  for (const f of predFeatures) {
    const geom = f.geometry
    if (!geom) continue
    const rings =
      geom.type === 'Polygon'
        ? geom.coordinates
        : geom.type === 'MultiPolygon'
        ? geom.coordinates.flat(1)
        : []
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = projectToMetric(ring[i], center)
        const [bx, by] = projectToMetric(ring[i + 1], center)
        const segLen = Math.hypot(bx - ax, by - ay)
        const numSteps = Math.max(1, Math.round(segLen / stepM))

        for (let s = 0; s < numSteps; s++) {
          const t = s / numSteps
          const px = ax + t * (bx - ax)
          const py = ay + t * (by - ay)

          let minDist = Infinity
          for (let k = 0; k < gtSegments.length; k++) {
            const seg = gtSegments[k]
            const d = pointToSegmentDist(px, py, seg[0], seg[1], seg[2], seg[3])
            if (d < minDist) {
              minDist = d
            }
          }
          if (Number.isFinite(minDist)) {
            distances.push(minDist)
          }
        }
      }
    }
  }

  if (!distances.length) {
    return { mean_m: 0, median_m: 0, p90_m: 0, rmse_m: 0 }
  }

  distances.sort((a, b) => a - b)
  const n = distances.length
  const sum = distances.reduce((acc, v) => acc + v, 0)
  const mean = sum / n
  const median = distances[Math.floor(n * 0.5)]
  const p90 = distances[Math.min(n - 1, Math.floor(n * 0.9))]
  const sumSq = distances.reduce((acc, v) => acc + v * v, 0)
  const rmse = Math.sqrt(sumSq / n)

  return {
    mean_m: Number(mean.toFixed(3)),
    median_m: Number(median.toFixed(3)),
    p90_m: Number(p90.toFixed(3)),
    rmse_m: Number(rmse.toFixed(3)),
  }
}

/**
 * Computes polygon IoU scores, bipartite matching, precision, recall, F1,
 * and categorizes features for map visualization.
 *
 * @param {Object} predFc - Predicted GeoJSON FeatureCollection
 * @param {Object} gtFc - Ground-truth GeoJSON FeatureCollection
 * @param {number} iouMatch - IoU threshold for matching (default 0.5)
 * @param {number} stepM - Boundary offset sampling step in metres (default 0.5)
 */
export function computeMetrics(predFc, gtFc, iouMatch = 0.5, stepM = 0.5) {
  if (!predFc || !gtFc) return null

  const predFeatures = (predFc.features || []).map(asFeature).filter((f) => f && f.geometry)
  const gtFeatures = (gtFc.features || []).map(asFeature).filter((f) => f && f.geometry)

  if (predFeatures.length === 0 || gtFeatures.length === 0) {
    return null
  }

  const predBboxes = predFeatures.map((f) => bbox(f))
  const gtBboxes = gtFeatures.map((f) => bbox(f))
  const predAreas = predFeatures.map((f) => area(f))
  const gtAreas = gtFeatures.map((f) => area(f))

  const usedGt = new Set()
  const predMatches = new Map()
  const matchedIous = []

  // Matching in prediction order: find best unmatched GT with IoU >= iouMatch
  for (let i = 0; i < predFeatures.length; i++) {
    const pf = predFeatures[i]
    const pb = predBboxes[i]
    const pa = predAreas[i]

    let bestIou = 0.0
    let bestJ = null

    for (let j = 0; j < gtFeatures.length; j++) {
      if (usedGt.has(j)) continue
      const gb = gtBboxes[j]
      if (!bboxHit(pb, gb)) continue

      const gf = gtFeatures[j]
      let inter = null
      try {
        inter = intersect(featureCollection([pf, gf]))
      } catch {
        inter = null
      }

      if (!inter) continue
      const interArea = area(inter)
      const ga = gtAreas[j]
      const iou = interArea / (pa + ga - interArea + 1e-9)

      if (iou > bestIou) {
        bestIou = iou
        bestJ = j
      }
    }

    if (bestIou >= iouMatch && bestJ !== null) {
      usedGt.add(bestJ)
      matchedIous.push(bestIou)
      predMatches.set(i, { gtIdx: bestJ, iou: bestIou })
    }
  }

  const tp = matchedIous.length
  const fp = predFeatures.length - tp
  const fn = gtFeatures.length - tp
  const precision = tp / Math.max(tp + fp, 1)
  const recall = tp / Math.max(tp + fn, 1)
  const f1 = (2 * precision * recall) / Math.max(precision + recall, 1e-9)
  const meanMatchedIou = matchedIous.length
    ? matchedIous.reduce((a, b) => a + b, 0) / matchedIous.length
    : 0.0

  const bo = computeBoundaryOffset(predFeatures, gtFeatures, stepM)

  // Categorize GeoJSON features for map visualization
  const tpFeatures = []
  const fpFeatures = []
  const fnFeatures = []

  predFeatures.forEach((f, idx) => {
    const match = predMatches.get(idx)
    if (match) {
      tpFeatures.push({
        ...f,
        properties: {
          ...f.properties,
          eval_status: 'tp',
          eval_label: 'Matched building',
          iou: Number(match.iou.toFixed(4)),
          matched_gt_index: match.gtIdx,
        },
      })
    } else {
      fpFeatures.push({
        ...f,
        properties: {
          ...f.properties,
          eval_status: 'fp',
          eval_label: 'False positive candidate',
          iou: 0,
        },
      })
    }
  })

  gtFeatures.forEach((f, idx) => {
    if (!usedGt.has(idx)) {
      fnFeatures.push({
        ...f,
        properties: {
          ...f.properties,
          eval_status: 'fn',
          eval_label: 'Missed reference building',
          gt_index: idx,
        },
      })
    }
  })

  return {
    summary: {
      n_pred: predFeatures.length,
      n_gt: gtFeatures.length,
      tp,
      fp,
      fn,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      mean_matched_iou: Number(meanMatchedIou.toFixed(4)),
      boundary_offset: bo,
      iou_threshold: iouMatch,
    },
    layers: {
      tp: { type: 'FeatureCollection', features: tpFeatures },
      fp: { type: 'FeatureCollection', features: fpFeatures },
      fn: { type: 'FeatureCollection', features: fnFeatures },
      all_gt: gtFc,
    },
  }
}
