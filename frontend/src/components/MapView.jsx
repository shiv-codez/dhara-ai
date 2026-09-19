import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import pointOnFeature from '@turf/point-on-feature'
import { LANDUSE_TINT, STATUS, ISSUE_LABEL } from '../lib/steps.js'

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function parcelStyle(f, mode, statuses, selectedId) {
  const id = f.properties.parcel_id
  const sel = id === selectedId
  const fill = mode === 'status' ? STATUS[statuses[id]?.status || 'draft'].color : LANDUSE_TINT[f.properties.landuse] || '#ddd'
  return {
    color: sel ? '#12233F' : '#C8402B',
    weight: sel ? 3.2 : 1.6,
    fillColor: fill,
    fillOpacity: mode === 'status' ? 0.42 : 0.45,
    opacity: 1,
  }
}

const issueColor = { error: '#D62839', warning: '#E8A317', info: '#4C6EF5' }

export default function MapView({
  scene, vis, regMode, fixMode, styleMode, parcels, rebuildKey, statuses, selectedId, onSelect,
  editingId, onGeometryEdit, overlaps, focus,
}) {
  const el = useRef(null)
  const map = useRef(null)
  const L_ = useRef({})            // all leaflet layers by name
  const parcelLayers = useRef({})  // parcel_id -> polygon layer
  const overlapLayer = useRef(null)
  const cb = useRef({})
  cb.current = { onSelect, onGeometryEdit, editingId, parcels }

  // ---------------------------------------------------------------- map + static layers per scene
  useEffect(() => {
    const m = L.map(el.current, {
      zoomControl: false, attributionControl: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 16, maxZoom: 23,
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
    m.on('click', () => { if (!cb.current.editingId) cb.current.onSelect(null) })
    const zoomClass = () => el.current?.classList.toggle('zoom-low', m.getZoom() < 19.5)
    m.on('zoomend', zoomClass)
    return () => { m.remove(); map.current = null }
  }, [])

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
      buildingsRaw: gj(d.buildings_raw, { pane: 'bldPane', style: { color: '#ff7a8a', weight: 1, fillColor: '#ff7a8a', fillOpacity: 0.18 } }),
      buildings: gj(d.buildings, { pane: 'bldPane', style: { color: '#E2566B', weight: 1.4, fillColor: '#E2566B', fillOpacity: 0.28 } }),
      roads: gj(d.roads, { pane: 'parcelPane', style: { color: '#2563C9', weight: 1.4, fillColor: '#2563C9', fillOpacity: 0.3 } }),
      vegetation: gj(d.vegetation, { pane: 'parcelPane', style: { color: '#2F8F55', weight: 1, fillColor: '#3E9B63', fillOpacity: 0.3 } }),
    }
    m.setMaxBounds(b.pad(0.8))
    m.fitBounds(b, { padding: [24, 24], animate: false })
    el.current.classList.toggle('zoom-low', m.getZoom() < 19.5)
  }, [scene])

  // ---------------------------------------------------------------- parcels (rebuilt only on scene / external change)
  useEffect(() => {
    const m = map.current
    if (!m || !scene) return
    ;['parcels', 'labels'].forEach((k) => L_.current[k] && m.removeLayer(L_.current[k]))
    parcelLayers.current = {}
    const labels = L.layerGroup()
    const layer = L.geoJSON(cb.current.parcels, {
      pane: 'parcelPane',
      style: (f) => parcelStyle(f, 'landuse', {}, null),
      onEachFeature: (f, lyr) => {
        const id = f.properties.parcel_id
        parcelLayers.current[id] = lyr
        lyr.on('click', (e) => { L.DomEvent.stopPropagation(e); cb.current.onSelect(id) })
        const save = () => cb.current.onGeometryEdit(id, lyr.toGeoJSON().geometry)
        lyr.on('pm:edit', save)
        lyr.on('pm:markerdragend', save)
        const [lng, lat] = pointOnFeature(f).geometry.coordinates   // always inside the polygon
        L.marker([lat, lng], {
          pane: 'labelPane', interactive: false,
          icon: L.divIcon({ className: 'plot-no', html: `<span>${id.slice(-4)}</span>`, iconSize: [0, 0] }),
        }).addTo(labels)
      },
    })
    L_.current.parcels = layer
    L_.current.labels = labels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, rebuildKey])

  // ---------------------------------------------------------------- parcel styling
  useEffect(() => {
    Object.entries(parcelLayers.current).forEach(([, lyr]) =>
      lyr.setStyle(parcelStyle(lyr.feature, styleMode, statuses, selectedId)))
    const sel = parcelLayers.current[selectedId]
    if (sel) sel.bringToFront()
  }, [styleMode, statuses, selectedId, rebuildKey, scene])

  // ---------------------------------------------------------------- topology flag markers
  useEffect(() => {
    const m = map.current
    if (!m || !scene) return
    if (L_.current.issues) m.removeLayer(L_.current.issues)
    const fc = fixMode === 'before' ? scene.data.issues_before_fix : scene.data.issues
    L_.current.issues = L.geoJSON(fc, {
      pane: 'issuePane',
      pointToLayer: (f, ll) => L.circleMarker(ll, {
        radius: 7, color: '#fff', weight: 2, fillColor: issueColor[f.properties.severity], fillOpacity: 1,
      }),
      style: (f) => ({ color: issueColor[f.properties.severity], weight: 2, fillColor: issueColor[f.properties.severity], fillOpacity: 0.55 }),
      onEachFeature: (f, lyr) => lyr.bindTooltip(`<b>${ISSUE_LABEL[f.properties.type] || f.properties.type}</b><br>${f.properties.message}`, { sticky: true }),
    })
    syncVisibility()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, fixMode])

  // ---------------------------------------------------------------- visibility
  function syncVisibility() {
    const m = map.current
    if (!m) return
    const want = { ...vis }
    if (vis.buildingsRaw) {           // "Masks become clean polygons" step: raw vs regularised
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
      pane: 'overlapPane', interactive: false,
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
        /* layer is not on the map (parcels hidden) - nothing to edit */
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
