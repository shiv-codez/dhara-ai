import { useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import pointOnFeature from '@turf/point-on-feature'
import { LANDUSE_TINT, STATUS, ISSUE_LABEL } from '../lib/steps.js'
import { createHoverController, getParcelTooltipHtml } from '../lib/hoverController.js'
import { escapeHtml } from '../lib/sanitize.js'

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function getParcelStyle(f, mode, statuses, selectedId, isHovered, fillEnabled, fillOpacity) {
  const id = f.properties.parcel_id
  const sel = id === selectedId
  const hov = isHovered && !sel
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
    fillColor = '#4A2E44'
    currentFillOpacity = 0.16
  } else if (hov) {
    fillColor = '#4A2E44'
    currentFillOpacity = 0.08
  }

  let strokeColor = '#C8402B'
  let weight = 1.3

  if (sel) {
    strokeColor = '#4A2E44'
    weight = 3.2
  } else if (hov) {
    strokeColor = '#4A2E44'
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

export function computeCoverClipInset(containerRect, comparePos, imgRect) {
  if (!containerRect || !imgRect) return 0
  const dividerX = containerRect.left + (containerRect.width * (comparePos / 100))
  const dividerInImgX = dividerX - imgRect.left
  return Math.max(0, imgRect.width - dividerInImgX)
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
  inspectTarget = null,
  fillEnabled = false,
  fillOpacity = 0.35,
  fitNonce = 0,
  compareActive = false,
  comparePos = 50,
  groundTruthResult = null,
}) {
  const el = useRef(null)
  const map = useRef(null)
  const L_ = useRef({}) // all leaflet layers by name
  const parcelLayers = useRef({}) // parcel_id -> polygon layer
  const overlapLayer = useRef(null)
  const hoverCtrl = useRef(null)
  const rawCoverLayer = useRef(null)

  const cb = useRef({})
  cb.current = {
    onSelect,
    onGeometryEdit,
    editingId,
    parcels,
    selectedId,
    styleMode,
    statuses,
    fillEnabled,
    fillOpacity,
    compareActive,
    comparePos,
  }

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
    m.createPane('parcelPane').style.zIndex = 410
    m.createPane('bldPane').style.zIndex = 420
    m.createPane('gtPane').style.zIndex = 430
    m.createPane('overlapPane').style.zIndex = 450
    m.createPane('issuePane').style.zIndex = 460
    m.createPane('labelPane').style.zIndex = 470

    hoverCtrl.current = createHoverController({
      map: m,
      getStyle: (feature, isHovered) =>
        getParcelStyle(
          feature,
          cb.current.styleMode,
          cb.current.statuses,
          cb.current.selectedId,
          isHovered,
          cb.current.fillEnabled,
          cb.current.fillOpacity
        ),
      getTooltipContent: getParcelTooltipHtml,
    })

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
      if (hoverCtrl.current) {
        hoverCtrl.current.destroy()
        hoverCtrl.current = null
      }
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
          html: `<span>${escapeHtml(selFeature.properties.parcel_id.slice(-4))}</span>`,
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
            html: `<span>${escapeHtml(id.slice(-4))}</span>`,
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
    hoverCtrl.current?.clear()

    const labels = L.layerGroup()
    const layer = L.geoJSON(cb.current.parcels, {
      pane: 'parcelPane',
      style: (f) =>
        getParcelStyle(
          f,
          styleMode,
          statuses,
          selectedId,
          hoverCtrl.current?.getHoveredId() === f.properties.parcel_id,
          fillEnabled,
          fillOpacity
        ),
      onEachFeature: (f, lyr) => {
        const id = f.properties.parcel_id
        parcelLayers.current[id] = lyr

        const isCoveredByCompare = (e) => {
          if (!cb.current.compareActive) return false
          const m = map.current
          if (!m || !el.current) return false
          const containerRect = el.current.getBoundingClientRect()
          const clientX = e.originalEvent
            ? e.originalEvent.clientX
            : e.containerPoint
            ? containerRect.left + e.containerPoint.x
            : null
          if (clientX == null) return false
          const dividerX = containerRect.left + containerRect.width * (cb.current.comparePos / 100)
          return clientX < dividerX
        }

        // Click selection (ignored on left covered side of compare slider)
        lyr.on('click', (e) => {
          if (isCoveredByCompare(e)) return
          L.DomEvent.stopPropagation(e)
          cb.current.onSelect(id)
        })

        // Single shared hover controller handlers (ignored on left covered side of compare slider)
        lyr.on('mouseover', (e) => {
          if (isCoveredByCompare(e)) return
          hoverCtrl.current?.onMouseOver(e, id, lyr)
        })
        lyr.on('mousemove', (e) => {
          if (isCoveredByCompare(e)) {
            hoverCtrl.current?.clear()
            return
          }
          hoverCtrl.current?.onMouseMove(e, id, lyr)
        })
        lyr.on('mouseout', (e) => {
          hoverCtrl.current?.onMouseOut(e, id, lyr)
        })

        // Geoman geometry editing
        const save = () => cb.current.onGeometryEdit(id, lyr.toGeoJSON().geometry)
        lyr.on('pm:edit', save)
        lyr.on('pm:markerdragend', save)
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
    hoverCtrl.current?.updateCallbacks({
      getStyle: (feature, isHovered) =>
        getParcelStyle(feature, styleMode, statuses, selectedId, isHovered, fillEnabled, fillOpacity),
    })

    Object.entries(parcelLayers.current).forEach(([id, lyr]) => {
      const isHovered = hoverCtrl.current?.getHoveredId() === id
      lyr.setStyle(getParcelStyle(lyr.feature, styleMode, statuses, selectedId, isHovered, fillEnabled, fillOpacity))
    })
    const sel = parcelLayers.current[selectedId]
    if (sel) sel.bringToFront()

    updateLabels()
  }, [styleMode, statuses, selectedId, fillEnabled, fillOpacity, rebuildKey, scene, updateLabels])

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
      onEachFeature: (f, lyr) => {
        const typeLabel = escapeHtml(ISSUE_LABEL[f.properties.type] || f.properties.type || 'Issue')
        const msg = escapeHtml(f.properties.message || '')
        lyr.bindTooltip(`<b>${typeLabel}</b><br>${msg}`, { sticky: true })
      },
    })

    syncVisibility()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, fixMode])

  // ---------------------------------------------------------------- ground-truth evaluation layer
  useEffect(() => {
    const m = map.current
    if (!m) return

    if (L_.current.groundTruth) {
      if (m.hasLayer(L_.current.groundTruth)) {
        m.removeLayer(L_.current.groundTruth)
      }
      L_.current.groundTruth = null
    }

    if (!groundTruthResult || !groundTruthResult.layers) return

    const group = L.layerGroup()

    // 1. Matched Candidate Buildings (TP) - Solid Green
    const tpLayer = L.geoJSON(groundTruthResult.layers.tp, {
      pane: 'gtPane',
      style: {
        color: '#10B981',
        weight: 2.5,
        fillColor: '#10B981',
        fillOpacity: 0.35,
      },
      onEachFeature: (f, lyr) => {
        const iouPct = ((f.properties.iou || 0) * 100).toFixed(1)
        lyr.bindTooltip(
          `<b>Matched Building (TP)</b><br>IoU: <b>${iouPct}%</b> (Threshold ≥ 50%)`,
          { sticky: true }
        )
      },
    })
    group.addLayer(tpLayer)

    // 2. False Positive Candidate Buildings (FP) - Red
    const fpLayer = L.geoJSON(groundTruthResult.layers.fp, {
      pane: 'gtPane',
      style: {
        color: '#EF4444',
        weight: 2,
        fillColor: '#EF4444',
        fillOpacity: 0.28,
      },
      onEachFeature: (f, lyr) => {
        lyr.bindTooltip(
          `<b>False Positive Candidate (FP)</b><br>No matching reference building (IoU &lt; 50%)`,
          { sticky: true }
        )
      },
    })
    group.addLayer(fpLayer)

    // 3. Missed Ground-Truth Buildings (FN) - Dashed Purple
    const fnLayer = L.geoJSON(groundTruthResult.layers.fn, {
      pane: 'gtPane',
      style: {
        color: '#A855F7',
        weight: 2.5,
        dashArray: '6 4',
        fillColor: '#A855F7',
        fillOpacity: 0.22,
      },
      onEachFeature: (f, lyr) => {
        lyr.bindTooltip(
          `<b>Missed Reference Building (FN)</b><br>Reference survey building not matched by candidate`,
          { sticky: true }
        )
      },
    })
    group.addLayer(fnLayer)

    group.addTo(m)
    L_.current.groundTruth = group

    return () => {
      if (L_.current.groundTruth && m.hasLayer(L_.current.groundTruth)) {
        m.removeLayer(L_.current.groundTruth)
        L_.current.groundTruth = null
      }
    }
  }, [groundTruthResult])

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

  // ---------------------------------------------------------------- inspectTarget (auto-zoom + boundary glow)
  useEffect(() => {
    if (!inspectTarget?.id || !map.current) return
    const targetId = inspectTarget.id

    const applyFocusAndGlow = () => {
      if (!map.current) return
      map.current.invalidateSize({ debounceMoveend: true })
      const lyr = parcelLayers.current[targetId]
      if (lyr && lyr.getBounds) {
        const bounds = lyr.getBounds()
        if (bounds && bounds.isValid()) {
          const isReduced = reduceMotion()
          map.current.fitBounds(bounds, {
            padding: [80, 80],
            maxZoom: 20,
            animate: !isReduced,
            duration: isReduced ? 0 : 0.6,
          })
        }
        lyr.bringToFront()

        if (!reduceMotion()) {
          const pathEl = lyr.getElement?.()
          if (pathEl) {
            pathEl.classList.remove('parcel-inspect-glow')
            void pathEl.offsetWidth // force reflow to restart animation
            pathEl.classList.add('parcel-inspect-glow')
            setTimeout(() => {
              pathEl?.classList.remove('parcel-inspect-glow')
            }, 1500)
          }
        }
      }
    }

    applyFocusAndGlow()
    const t = setTimeout(applyFocusAndGlow, 80)
    return () => clearTimeout(t)
  }, [inspectTarget])

  // ---------------------------------------------------------------- compare slider via raw cover image
  const updateCoverClip = useCallback(() => {
    const m = map.current
    const lyr = rawCoverLayer.current
    if (!m || !lyr || !el.current || !compareActive) return
    const imgEl = lyr.getElement()
    if (!imgEl) return

    const containerRect = el.current.getBoundingClientRect()
    const imgRect = imgEl.getBoundingClientRect()
    const rightPx = computeCoverClipInset(containerRect, comparePos, imgRect)

    imgEl.style.clipPath = `inset(0 ${rightPx}px 0 0)`
  }, [compareActive, comparePos])

  useEffect(() => {
    const m = map.current
    if (!m || !scene) return

    if (!compareActive) {
      if (rawCoverLayer.current) {
        if (m.hasLayer(rawCoverLayer.current)) {
          m.removeLayer(rawCoverLayer.current)
        }
        rawCoverLayer.current = null
      }
      const pane = m.getPane('rawCoverPane')
      if (pane) {
        pane.parentNode?.removeChild(pane)
        const panes = m.getPanes?.() || {}
        delete panes.rawCoverPane
      }
      return
    }

    // Compare is ACTIVE: ensure rawCoverPane exists at zIndex 640
    let pane = m.getPane('rawCoverPane')
    if (!pane) {
      pane = m.createPane('rawCoverPane')
      pane.style.zIndex = 640
      pane.style.pointerEvents = 'none'
    }

    if (!rawCoverLayer.current) {
      const b = L.latLngBounds(scene.manifest.bounds)
      const lyr = L.imageOverlay(scene.urls.ortho, b, {
        pane: 'rawCoverPane',
        interactive: false,
      })
      lyr.addTo(m)
      rawCoverLayer.current = lyr
    }

    const onAnim = () => {
      updateCoverClip()
    }

    m.on('move moveend zoom zoomend zoomanim resize', onAnim)

    // Run clip calculation on next frame once image element is mounted in DOM
    const frameId = requestAnimationFrame(updateCoverClip)

    return () => {
      cancelAnimationFrame(frameId)
      m.off('move moveend zoom zoomend zoomanim resize', onAnim)
    }
  }, [compareActive, scene, updateCoverClip])

  // Also update clip whenever comparePos changes
  useEffect(() => {
    if (compareActive) {
      updateCoverClip()
      hoverCtrl.current?.clear()
    }
  }, [comparePos, compareActive, updateCoverClip])

  return <div ref={el} className="map" role="application" aria-label="Parcel map" />
}
