// In-browser topology checks used while an officer edits a boundary.
// The authoritative validation runs in the Python pipeline (Shapely); this mirrors the
// parcel-overlap rule so an edit is judged instantly, without a server round-trip.
import intersect from '@turf/intersect'
import difference from '@turf/difference'
import area from '@turf/area'
import bbox from '@turf/bbox'
import { featureCollection } from '@turf/helpers'

const bboxHit = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1])
const asFeature = (f) => (f.type === 'Feature' ? f : { type: 'Feature', properties: {}, geometry: f })

/** Overlaps between one (edited) parcel and every other parcel. Ignores ribbons under `minArea` m2. */
export function overlapsFor(edited, all, minArea = 0.25) {
  const eb = bbox(edited)
  const out = []
  for (const f of all) {
    if (f.properties.parcel_id === edited.properties.parcel_id) continue
    if (!bboxHit(eb, bbox(f))) continue
    let inter = null
    try {
      inter = intersect(featureCollection([asFeature(edited), asFeature(f)]))
    } catch {
      inter = null
    }
    if (!inter) continue
    const a = area(inter)
    if (a >= minArea) out.push({ with: f.properties.parcel_id, area: a, feature: inter })
  }
  return out
}

/** Deterministic resolution: the edited parcel gives up the overlapped ground. */
export function resolveOverlaps(edited, overlaps, all) {
  let cur = asFeature(edited)
  const byId = new Map(all.map((f) => [f.properties.parcel_id, f]))
  for (const o of overlaps) {
    const other = byId.get(o.with)
    if (!other) continue
    const d = difference(featureCollection([cur, asFeature(other)]))
    if (d) cur = { ...cur, geometry: d.geometry }
  }
  return cur.geometry
}

export const areaM2 = (f) => area(asFeature(f))
export const boundsOf = (f) => {
  const [w, s, e, n] = bbox(asFeature(f))
  return [[s, w], [n, e]]
}
