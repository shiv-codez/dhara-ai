import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import pointOnFeature from '@turf/point-on-feature'
import { LANDUSE_TINT, STATUS, ISSUE_LABEL } from '../lib/steps.js'

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function getParcelStyle(f, mode, statuses, selectedId, hoveredId, fillEnabled, fillOpacity) {
  const id = f.properties.parcel_id
  const sel = id === selectedId
  const hov = id === hoveredId
  const isStatus = mode === 'status'

  let fillColor = 'transparent'
  let currentFillOpacity = 0

  if (isStatus) {
    fillColor = STATUS[statuses[id]?.status || 'draft'].color
    currentFillOpacity = sel ? 0.45 : hov ? 0.35 : 0.22
  } else if (fillEnabled) {
    fillColor = LANDUSE_TINT[f.properties.landuse] || '#ddd'
    currentFillOpacity = sel ? Math.min(1, fillOpacity + 0.18) : hov ? Math.min(1, fillOpacity + 0.1) : fillOpacity
  } else if (sel) {
    fillColor = '#12233F'
    currentFillOpacity = 0.12
  } else if (hov) {
    fillColor = '#0052CC'
    currentFillOpacity = 0.08
  }

  let strokeColor = '#C8402B'
  let weight = 1.3

  if (sel) {
    strokeColor = '#12233F'
    weight = 3.2
  } else if (hov) {
    strokeColor = '#0052CC'
    weight = 2.4
  }

  return {
    color: strokeColor,
    weight,
    fillColor,
    fillOpacity: currentFillOpacity,
    opacity: 1,
  }
}

const issueColor = { error: '#D62839', warning: '#E8A317', info: '#4C6EF5' }

export default function MapView({
  scene,
  vis,
  regMode,
  fixMode,
  styleMode,
  parcels,
  rebuildKey,
  statuses,
  selectedId,
  onSelect,
  editingId,
  onGeometryEdit,
  overlaps,
  focus,
  fillEnabled = false,
  fillOpacity = 0.35,
  fitNonce = 0,
}) {
  const el = useRef(null)
  const map = useRef(null)
  const L_ = useRef({}) // all leaflet layers by name
  const parcelLayers = useRef({}) // parcel_id -> polygon layer
  const overlapLayer = useRef(null)
  const [hoveredId, setHoveredId] = useState(null)

  const cb = useRef({})
  cb.current = { onSelect, onGeometryEdit, editingId, parcels, selectedId }

  // ---------------------------------------------------------------- map + static panes per scene
  useEffect(() => {
    const m = L.map(el.current, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      minZoom: 16,
      maxZoom: 23,
    })
    map.current = m

    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(m)

    m.createPane('orthoPane').style.zIndex = 200
    m.createPane('segPane').style.zIndex = 250
    m.createPane('maskPane').style.zIndex = 260
    m.createPane('bldPane').style.zIndex = 420
    m.createPane('parcelPane').style.zIndex = 410
    m.createPane('overlapPane').style.zIndex = 450
    m.createPane('issuePane').style.zIndex = 460
    m.createPane('labelPane').style.zIndex = 470

    m.on('click', () => {
      if (!cb.current.editingId) cb.current.onSelect(null)
    })

    // Auto-resize on stage geometry changes
    let ro = null
    if (window.ResizeObserver && el.current) {
      ro = new ResizeObserver(() => {
        if (map.current) {
          map.current.invalidateSize({ debounceMoveend: true })
        }
      })
      ro.observe(el.current)
    }

    return () => {
      if (ro) ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  // ---------------------------------------------------------------- label collision update
  const updateLabels = useCallback(() => {
    const m = map.current
    if (!m || !scene) return
    const labelsGroup = L_.current.labels
    if (!labelsGroup) return
    labelsGroup.clearLayers()

    if (!vis.labels) return

    const z = m.getZoom()
    const size = m.getSize()
    const placed = [] // Array of { x1, y1, x2, y2 }

    const collides = (b) => placed.some((p) => !(b.x2 < p.x1 || b.x1 > p.x2 || b.y2 < p.y1 || b.y1 > p.y2))

    const allFeatures = parcels?.features || []

    // 1. Always place selected parcel label first if present
    const selFeature = allFeatures.find((f) => f.properties.parcel_id === selectedId)
    if (selFeature) {
      const [lng, lat] = pointOnFeature(selFeature).geometry.coordinates
      const pt = m.latLngToContainerPoint([lat, lng])
      const box = { x1: pt.x - 24, y1: pt.y - 12, x2: pt.x + 24, y2: pt.y + 12 }
      placed.push(box)
      L.marker([lat, lng], {
        pane: 'labelPane',
        interactive: false,
        icon: L.divIcon({
          className: 'plot-no selected',
          html: `<span>${selFeature.properties.parcel_id.slice(-4)}</span>`,
          iconSize: [0, 0],
        }),
      }).addTo(labelsGroup)
    }

    // When zoomed out too far, don't clutter with unreadable labels
    if (z < 18.0) return

    // 2. Sort candidate features: High priority first, then Medium, then Low; then larger area first
    const prioRank = { High: 0, Medium: 1, Low: 2 }
    const sorted = allFeatures
      .filter((f) => f.properties.parcel_id !== selectedId)
      .sort((a, b) => {
        const prA = prioRank[a.properties.review_priority] ?? 2
        const prB = prioRank[b.properties.review_priority] ?? 2
        if (prA !== prB) return prA - prB
        return (b.properties.area_m2 || 0) - (a.properties.area_m2 || 0)
      })

    for (const f of sorted) {
      const id = f.properties.parcel_id
      const [lng, lat] = pointOnFeature(f).geometry.coordinates
      const pt = m.latLngToContainerPoint([lat, lng])

      // Viewport clipping with margin
      if (pt.x < -30 || pt.y < -30 || pt.x > size.x + 30 || pt.y > size.y + 30) continue

      // Approximate label badge dimensions with padding
      const box = { x1: pt.x - 20, y1: pt.y - 10, x2: pt.x + 20, y2: pt.y + 10 }
      if (!collides(box)) {
        placed.push(box)
        L.marker([lat, lng], {
          pane: 'labelPane',
          interactive: false,
          icon: L.divIcon({
            className: 'plot-no',
            html: `<span>${id.slice(-4)}</span>`,
            iconSize: [0, 0],
          }),
        }).addTo(labelsGroup)
      }
    }
  }, [scene, vis.labels, parcels, selectedId])

  // Attach moveend/zoomend listener for dynamic label placement
  useEffect(() => {
    const m = map.current
    if (!m) return
    m.on('moveend', updateLabels)
    m.on('zoomend', updateLabels)
    return () => {
      m.off('moveend', updateLabels)
      m.off('zoomend', updateLabels)
    }
  }, [updateLabels])

  // ---------------------------------------------------------------- static raster & vector layers per scene
  useEffect(() => {
    const m = map.current
    if (!m || !scene) return
    const prev = L_.current
    Object.values(prev).forEach((l) => l && m.hasLayer(l) && m.removeLayer(l))

    const b = L.latLngBounds(scene.manifest.bounds)
    const img = (url, pane) => L.imageOverlay(url, b, { pane, interactive: false })
    const gj = (data, opts) => L.geoJSON(data, { interactive: false, ...opts })
    const d = scene.data

    L_.current = {
      ortho: img(scene.urls.ortho, 'orthoPane'),
      segments: img(scene.urls.segments, 'segPane'),
      masks: img(scene.urls.masks, 'maskPane'),
      buildingsRaw: gj(d.buildings_raw, {
        pane: 'bldPane',
        style: { color: '#ff7a8a', weight: 1, fillColor: '#ff7a8a', fillOpacity: 0.18 },
      }),
      buildings: gj(d.buildings, {
        pane: 'bldPane',
        style: { color: '#E2566B', weight: 1.4, fillColor: '#E2566B', fillOpacity: 0.28 },
      }),
      roads: gj(d.roads, {
        pane: 'parcelPane',
        style: { color: '#2563C9', weight: 1.4, fillColor: '#2563C9', fillOpacity: 0.3 },
      }),
      vegetation: gj(d.vegetation, {
        pane: 'parcelPane',
        style: { color: '#2F8F55', weight: 1, fillColor: '#3E9B63', fillOpacity: 0.3 },
      }),
    }

    m.setMaxBounds(b.pad(0.8))
    m.fitBounds(b, { padding: [24, 24], animate: false })
  }, [scene])

  // Fit bounds when fitNonce changes
  useEffect(() => {
    if (!fitNonce || !map.current || !scene) return
    const b = L.latLngBounds(scene.manifest.bounds)
    map.current.fitBounds(b, { padding: [24, 24], animate: !reduceMotion() })
  }, [fitNonce, scene])

  // ---------------------------------------------------------------- parcels (rebuilt on scene / external edit)
  useEffect(() => {
    const m = map.current
    if (!m || !scene) return
    ;['parcels', 'labels'].forEach((k) => L_.current[k] && m.removeLayer(L_.current[k]))
    parcelLayers.current = {}

    const labels = L.layerGroup()
    const layer = L.geoJSON(cb.current.parcels, {
      pane: 'parcelPane',
      style: (f) => getParcelStyle(f, styleMode, statuses, selectedId, null, fillEnabled, fillOpacity),
      onEachFeature: (f, lyr) => {
        const id = f.properties.parcel_id
        const p = f.properties
        parcelLayers.current[id] = lyr

        // Click selection
        lyr.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          cb.current.onSelect(id)
        })

        // Hover highlight
        lyr.on('mouseover', () => {
          setHoveredId(id)
        })
        lyr.on('mouseout', () => {
          setHoveredId(null)
        })

        // Geoman geometry editing
        const save = () => cb.current.onGeometryEdit(id, lyr.toGeoJSON().geometry)
        lyr.on('pm:edit', save)
        lyr.on('pm:markerdragend', save)

        // Rich tooltip on hover
        const shortId = id.slice(-4)
        const area = Number(p.area_m2 || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })
        const prio = p.review_priority || 'Low'
        const tooltipHtml = `
          <div class="parcel-tip">
            <div class="tip-top">
              <strong>Plot ${shortId}</strong>
              <span class="tip-prio prio ${prio.toLowerCase()}">${prio}</span>
            </div>
            <div class="tip-row"><span>Area:</span> <b>${area} m²</b></div>
            <div class="tip-row"><span>Land use:</span> <b>${p.landuse || 'Unknown'}</b></div>
            ${p.review_reasons ? `<div class="tip-reason">${p.review_reasons}</div>` : ''}
          </div>
        `
        lyr.bindTooltip(tooltipHtml, {
          sticky: true,
          direction: 'top',
          offset: [0, -6],
          className: 'dhara-tooltip',
        })
      },
    })

    L_.current.parcels = layer
    L_.current.labels = labels

    syncVisibility()
    updateLabels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, rebuildKey])

  // ---------------------------------------------------------------- parcel dynamic styling on state change
  useEffect(() => {
    Object.entries(parcelLayers.current).forEach(([id, lyr]) => {
      lyr.setStyle(getParcelStyle(lyr.feature, styleMode, statuses, selectedId, hoveredId, fillEnabled, fillOpacity))
    })
    const sel = parcelLayers.current[selectedId]
    if (sel) sel.bringToFront()
    const hov = parcelLayers.current[hoveredId]
    if (hov && hoveredId !== selectedId) hov.bringToFront()

    updateLabels()
  }, [styleMode, statuses, selectedId, hoveredId, fillEnabled, fillOpacity, rebuildKey, scene, updateLabels])

  // ---------------------------------------------------------------- topology flag markers
  useEffect(() => {
    const m = map.current
    if (!m || !scene) return
    if (L_.current.issues) m.removeLayer(L_.current.issues)

    const fc = fixMode === 'before' ? scene.data.issues_before_fix : scene.data.issues
    L_.current.issues = L.geoJSON(fc, {
      pane: 'issuePane',
      pointToLayer: (f, ll) =>
        L.circleMarker(ll, {
          radius: 7,
          color: '#fff',
          weight: 2,
          fillColor: issueColor[f.properties.severity],
          fillOpacity: 1,
        }),
      style: (f) => ({
        color: issueColor[f.properties.severity],
        weight: 2,
        fillColor: issueColor[f.properties.severity],
        fillOpacity: 0.55,
      }),
      onEachFeature: (f, lyr) =>
        lyr.bindTooltip(
          `<b>${ISSUE_LABEL[f.properties.type] || f.properties.type}</b><br>${f.properties.message}`,
          { sticky: true }
        ),
    })

    syncVisibility()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, fixMode])

  // ---------------------------------------------------------------- visibility sync
  function syncVisibility() {
    const m = map.current
    if (!m) return
    const want = { ...vis }
    if (vis.buildingsRaw) {
      want.buildingsRaw = regMode === 'raw'
      want.buildings = regMode !== 'raw'
    }
    Object.entries(L_.current).forEach(([k, l]) => {
      if (!l) return
      const on = !!want[k]
      if (on && !m.hasLayer(l)) l.addTo(m)
      if (!on && m.hasLayer(l)) m.removeLayer(l)
    })
  }
  useEffect(syncVisibility, [vis, regMode, scene, rebuildKey, fixMode])

  // ---------------------------------------------------------------- overlaps drawn while editing
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (overlapLayer.current) m.removeLayer(overlapLayer.current)
    overlapLayer.current = L.geoJSON((overlaps || []).map((o) => o.feature), {
      pane: 'overlapPane',
      interactive: false,
      style: { color: '#B3001B', weight: 2, dashArray: '4 3', fillColor: '#FF2D55', fillOpacity: 0.65 },
    }).addTo(m)
  }, [overlaps])

  // ---------------------------------------------------------------- vertex editing (Leaflet-Geoman)
  useEffect(() => {
    Object.entries(parcelLayers.current).forEach(([id, lyr]) => {
      try {
        if (id === editingId) lyr.pm.enable({ allowSelfIntersection: false, snappable: true, snapDistance: 10 })
        else if (lyr.pm.enabled()) lyr.pm.disable()
      } catch {
        /* layer is not on the map - nothing to edit */
      }
    })
  }, [editingId, rebuildKey])

  // ---------------------------------------------------------------- focus requests
  useEffect(() => {
    if (!focus || !map.current) return
    const b = L.latLngBounds(focus.bounds)
    map.current.flyToBounds(b.pad(1.2), { maxZoom: 22, duration: reduceMotion() ? 0 : 0.6 })
  }, [focus])

  return <div ref={el} className="map" role="application" aria-label="Parcel map" />
}
