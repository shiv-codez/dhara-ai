import { test, expect, beforeAll, afterEach } from 'vitest'

beforeAll(() => {
  if (typeof window !== 'undefined') {
    if (!window.SVGElement) window.SVGElement = class SVGElement extends HTMLElement {}
    window.SVGElement.prototype.createSVGRect = () => ({})
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
  }
})

afterEach(() => {
  document.body.innerHTML = ''
})

test('hoverController: 50 rapid mouseovers without mouseout keeps at most 1 highlighted parcel and 1 tooltip', async () => {
  const { default: L } = await import('leaflet')
  const { createHoverController, getParcelTooltipHtml } = await import('../src/lib/hoverController.js')
  const container = document.createElement('div')
  container.style.width = '800px'
  container.style.height = '600px'
  document.body.appendChild(container)

  const map = L.map(container, {
    center: [28.6139, 77.209],
    zoom: 18,
  })

  const styleStates = new Map() // layerId -> isHovered boolean

  const getStyle = (feature, isHovered) => {
    const id = feature.properties.parcel_id
    styleStates.set(id, isHovered)
    return {
      color: isHovered ? '#0052CC' : '#C8402B',
      weight: isHovered ? 2.4 : 1.3,
    }
  }

  const hoverCtrl = createHoverController({
    map,
    getStyle,
    getTooltipContent: getParcelTooltipHtml,
  })

  // Create 50 mock parcel layers
  const layers = []
  for (let i = 1; i <= 50; i++) {
    const id = `TMP-PARCEL-${String(i).padStart(4, '0')}`
    const feature = {
      type: 'Feature',
      properties: {
        parcel_id: id,
        area_m2: 150 + i * 10,
        landuse: 'Built-up',
        review_priority: i % 3 === 0 ? 'High' : i % 2 === 0 ? 'Medium' : 'Low',
        review_reasons: i % 3 === 0 ? '55% vegetation' : '',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.209 + i * 0.0001, 28.6139],
            [77.2091 + i * 0.0001, 28.6139],
            [77.2091 + i * 0.0001, 28.614],
            [77.209 + i * 0.0001, 28.614],
            [77.209 + i * 0.0001, 28.6139],
          ],
        ],
      },
    }

    const gj = L.geoJSON(feature, {
      style: (f) => getStyle(f, false),
    }).addTo(map)
    const lyr = gj.getLayers()[0]
    lyr.feature = feature
    layers.push({ id, lyr })
  }

  // 1. Simulate 50 rapid mouseovers WITHOUT ANY mouseout in between
  for (let i = 0; i < 50; i++) {
    const { id, lyr } = layers[i]
    const event = {
      latlng: L.latLng(28.6139 + i * 0.0001, 77.209 + i * 0.0001),
    }
    hoverCtrl.onMouseOver(event, id, lyr)

    // Assert that after each mouseover, only the current parcel is marked hovered
    expect(hoverCtrl.getHoveredId()).toBe(id)

    // Count how many layers currently have isHovered === true
    let hoveredCount = 0
    styleStates.forEach((isHovered) => {
      if (isHovered) hoveredCount++
    })
    expect(hoveredCount).toBe(1)

    // Count tooltip DOM elements
    const tooltips = container.querySelectorAll('.leaflet-tooltip')
    expect(tooltips.length).toBeLessThanOrEqual(1)
  }

  // Final check after 50 rapid mouseovers
  expect(hoverCtrl.getHoveredId()).toBe('TMP-PARCEL-0050')
  const finalTooltips = container.querySelectorAll('.leaflet-tooltip')
  expect(finalTooltips.length).toBe(1)
  expect(finalTooltips[0].textContent).toContain('Plot 0050')

  // Verify only parcel 50 is hovered, all 1..49 are false
  for (let i = 1; i <= 49; i++) {
    expect(styleStates.get(`TMP-PARCEL-${String(i).padStart(4, '0')}`)).toBe(false)
  }
  expect(styleStates.get('TMP-PARCEL-0050')).toBe(true)

  // 2. Test fail-safes clearing hover and closing tooltip
  // A. movestart
  map.fire('movestart')
  expect(hoverCtrl.getHoveredId()).toBeNull()
  expect(styleStates.get('TMP-PARCEL-0050')).toBe(false)
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(0)

  // Re-hover layer 10
  hoverCtrl.onMouseOver({ latlng: L.latLng(28.6139, 77.209) }, layers[9].id, layers[9].lyr)
  expect(hoverCtrl.getHoveredId()).toBe('TMP-PARCEL-0010')
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(1)

  // B. zoomstart
  map.fire('zoomstart')
  expect(hoverCtrl.getHoveredId()).toBeNull()
  expect(styleStates.get('TMP-PARCEL-0010')).toBe(false)
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(0)

  // Re-hover layer 20
  hoverCtrl.onMouseOver({ latlng: L.latLng(28.6139, 77.209) }, layers[19].id, layers[19].lyr)
  expect(hoverCtrl.getHoveredId()).toBe('TMP-PARCEL-0020')
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(1)

  // C. dragstart
  map.fire('dragstart')
  expect(hoverCtrl.getHoveredId()).toBeNull()
  expect(styleStates.get('TMP-PARCEL-0020')).toBe(false)
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(0)

  // Re-hover layer 30
  hoverCtrl.onMouseOver({ latlng: L.latLng(28.6139, 77.209) }, layers[29].id, layers[29].lyr)
  expect(hoverCtrl.getHoveredId()).toBe('TMP-PARCEL-0030')

  // D. window blur
  window.dispatchEvent(new Event('blur'))
  expect(hoverCtrl.getHoveredId()).toBeNull()
  expect(styleStates.get('TMP-PARCEL-0030')).toBe(false)
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(0)

  // Re-hover layer 40
  hoverCtrl.onMouseOver({ latlng: L.latLng(28.6139, 77.209) }, layers[39].id, layers[39].lyr)
  expect(hoverCtrl.getHoveredId()).toBe('TMP-PARCEL-0040')

  // E. document visibilitychange (hidden)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  document.dispatchEvent(new Event('visibilitychange'))
  expect(hoverCtrl.getHoveredId()).toBeNull()
  expect(styleStates.get('TMP-PARCEL-0040')).toBe(false)
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(0)

  // Re-hover layer 5
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  hoverCtrl.onMouseOver({ latlng: L.latLng(28.6139, 77.209) }, layers[4].id, layers[4].lyr)
  expect(hoverCtrl.getHoveredId()).toBe('TMP-PARCEL-0005')

  // F. container mouseleave
  container.dispatchEvent(new MouseEvent('mouseleave'))
  expect(hoverCtrl.getHoveredId()).toBeNull()
  expect(styleStates.get('TMP-PARCEL-0005')).toBe(false)
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(0)

  // Re-hover layer 1 and normal mouseOut
  hoverCtrl.onMouseOver({ latlng: L.latLng(28.6139, 77.209) }, layers[0].id, layers[0].lyr)
  expect(hoverCtrl.getHoveredId()).toBe('TMP-PARCEL-0001')
  hoverCtrl.onMouseOut({}, layers[0].id)
  expect(hoverCtrl.getHoveredId()).toBeNull()
  expect(styleStates.get('TMP-PARCEL-0001')).toBe(false)
  expect(container.querySelectorAll('.leaflet-tooltip').length).toBe(0)

  hoverCtrl.destroy()
  map.remove()
})
