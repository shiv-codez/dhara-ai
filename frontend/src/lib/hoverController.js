import L from 'leaflet'

/**
 * Single shared hover controller for map parcel layers.
 * Guarantees at most ONE highlighted parcel and ONE tooltip at any time.
 * Avoids per-polygon bindTooltip and state-driven full map restyles.
 */
export function createHoverController({ map, getStyle, getTooltipContent }) {
  let hoveredId = null
  let hoveredLayer = null

  const tooltip = L.tooltip({
    direction: 'top',
    offset: L.point(0, -8),
    interactive: false,
    opacity: 1,
    className: 'dhara-tooltip',
  })

  function clear() {
    if (hoveredLayer) {
      try {
        hoveredLayer.setStyle(getStyle(hoveredLayer.feature, false))
      } catch {
        // layer might have been removed
      }
    }
    hoveredId = null
    hoveredLayer = null
    if (map && tooltip.isOpen()) {
      map.closeTooltip(tooltip)
    }
  }

  function onMouseOver(e, id, layer) {
    if (!layer || !layer.feature) return

    // If already hovering this exact layer, just move tooltip
    if (hoveredId === id && hoveredLayer === layer) {
      if (e.latlng && tooltip.isOpen()) {
        tooltip.setLatLng(e.latlng)
      }
      return
    }

    // 1. Reset previously highlighted layer first
    if (hoveredLayer && hoveredLayer !== layer) {
      try {
        hoveredLayer.setStyle(getStyle(hoveredLayer.feature, false))
      } catch {}
    }

    hoveredId = id
    hoveredLayer = layer

    // 2. Highlight only this layer (NO bringToFront)
    try {
      hoveredLayer.setStyle(getStyle(layer.feature, true))
    } catch {}

    // 3. Update single shared tooltip
    if (getTooltipContent && map) {
      const content = getTooltipContent(layer.feature.properties)
      tooltip.setContent(content)
      const latlng = e.latlng || layer.getBounds?.().getCenter?.()
      if (latlng) {
        tooltip.setLatLng(latlng)
        if (!tooltip.isOpen()) {
          map.openTooltip(tooltip)
        }
      }
    }
  }

  function onMouseMove(e, id, layer) {
    if (hoveredId === id && tooltip.isOpen() && e.latlng) {
      tooltip.setLatLng(e.latlng)
    } else if (hoveredId !== id) {
      onMouseOver(e, id, layer)
    }
  }

  function onMouseOut(e, id) {
    if (hoveredId === id) {
      clear()
    }
  }

  // ---------------------------------------------------------------- fail-safes
  const mapContainer = map?.getContainer?.()

  const onMapMouseOut = (e) => {
    const toElement = e.toElement || e.relatedTarget
    if (!toElement || (mapContainer && !mapContainer.contains(toElement))) {
      clear()
    }
  }

  const onVisibilityChange = () => {
    if (document.hidden) clear()
  }

  const onWindowBlur = () => {
    clear()
  }

  if (map) {
    map.on('mouseout', onMapMouseOut)
    map.on('movestart', clear)
    map.on('zoomstart', clear)
    map.on('dragstart', clear)
    map.on('click', clear)
  }

  if (mapContainer) {
    mapContainer.addEventListener('mouseleave', clear)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', onWindowBlur)
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    getHoveredId: () => hoveredId,
    getHoveredLayer: () => hoveredLayer,
    getTooltip: () => tooltip,
    onMouseOver,
    onMouseMove,
    onMouseOut,
    clear,
    destroy() {
      clear()
      if (map) {
        map.off('mouseout', onMapMouseOut)
        map.off('movestart', clear)
        map.off('zoomstart', clear)
        map.off('dragstart', clear)
        map.off('click', clear)
      }
      if (mapContainer) {
        mapContainer.removeEventListener('mouseleave', clear)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', onWindowBlur)
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      if (map && tooltip.isOpen()) {
        map.closeTooltip(tooltip)
      }
    },
    updateCallbacks({ getStyle: newGetStyle, getTooltipContent: newGetTooltipContent }) {
      if (newGetStyle) getStyle = newGetStyle
      if (newGetTooltipContent) getTooltipContent = newGetTooltipContent
    },
  }
}

export function getParcelTooltipHtml(properties) {
  const p = properties || {}
  const id = p.parcel_id || ''
  const shortId = id.slice(-4)
  const area = Number(p.area_m2 || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })
  const prio = p.review_priority || 'Low'
  return `
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
}
