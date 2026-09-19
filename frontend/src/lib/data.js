import { areaM2 } from './geo.js'

const FILES = ['parcels', 'parcels_before_fix', 'buildings', 'buildings_raw', 'roads', 'vegetation', 'open_ground', 'issues', 'issues_before_fix']
const base = (id) => `${import.meta.env.BASE_URL}data/${id}`.replace('//', '/')

export async function loadIndex() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/index.json`)
  if (!r.ok) throw new Error('Scene index not found')
  return r.json()
}

export async function loadScene(id) {
  const root = base(id)
  const [manifest, ...layers] = await Promise.all([
    fetch(`${root}/manifest.json`).then((r) => r.json()),
    ...FILES.map((f) => fetch(`${root}/${f}.geojson`).then((r) => r.json())),
  ])
  const data = Object.fromEntries(FILES.map((f, i) => [f, layers[i]]))
  return {
    id,
    manifest,
    urls: {
      ortho: `${root}/ortho.jpg`,
      masks: `${root}/masks.png`,
      segments: `${root}/segments.png`,
      gpkg: `${root}/${id}_dhara_candidates.gpkg`,
    },
    data,
  }
}

const KEY = (id) => `dhara:v1:${id}`
export const loadSaved = (id) => {
  try {
    return JSON.parse(localStorage.getItem(KEY(id))) || {}
  } catch {
    return {}
  }
}
export const saveSaved = (id, obj) => {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(obj))
  } catch {
    /* storage may be blocked - the demo still works, just without persistence */
  }
}

export function download(name, text, type = 'application/geo+json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Parcels with review status + edits applied, ready for export. */
export function exportParcels(parcels, statuses, only) {
  const features = parcels.features
    .map((f) => {
      const s = statuses[f.properties.parcel_id] || { status: 'draft' }
      return {
        ...f,
        properties: {
          ...f.properties,
          status: s.status === 'draft' ? 'Draft / Unverified' : s.status,
          reviewer_note: s.note || '',
          area_m2: Math.round(areaM2(f) * 10) / 10,
        },
      }
    })
    .filter((f) => !only || f.properties.status === only)
  return JSON.stringify({ type: 'FeatureCollection', features })
}
