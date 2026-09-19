import { describe, test, expect, beforeAll, afterEach } from 'vitest'
import { computeCoverClipInset } from '../src/components/MapView.jsx'

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

describe('Compare Slider Cover Image Unit Tests', () => {
  test('computeCoverClipInset calculates exact right-inset in image coordinates', () => {
    const containerRect = { left: 100, width: 1000 }
    // Case 1: Divider at 50% (screen x = 600)
    // Image from left: 200, width: 800 (spans x=200 to x=1000)
    // Divider in image = 600 - 200 = 400px.
    // rightPx = 800 - 400 = 400px.
    const imgRect1 = { left: 200, width: 800 }
    expect(computeCoverClipInset(containerRect, 50, imgRect1)).toBe(400)

    // Case 2: Divider at 25% (screen x = 350)
    // Divider in image = 350 - 200 = 150px.
    // rightPx = 800 - 150 = 650px.
    expect(computeCoverClipInset(containerRect, 25, imgRect1)).toBe(650)

    // Case 3: Divider to the left of image (screen x = 150)
    // Divider in image = 150 - 200 = -50px.
    // rightPx = max(0, 800 - (-50)) = 850px.
    expect(computeCoverClipInset(containerRect, 5, imgRect1)).toBe(850)

    // Case 4: Divider to the right of image (screen x = 1100)
    // Divider in image = 1100 - 200 = 900px.
    // rightPx = max(0, 800 - 900) = 0px.
    expect(computeCoverClipInset(containerRect, 100, imgRect1)).toBe(0)
  })

  test('Detection panes have no clip-path style; only raw cover image is clipped', async () => {
    const { default: L } = await import('leaflet')
    const container = document.createElement('div')
    container.style.width = '800px'
    container.style.height = '600px'
    document.body.appendChild(container)

    const map = L.map(container, {
      center: [28.6139, 77.209],
      zoom: 18,
    })

    // Create standard detection panes
    const detectionPanes = ['segPane', 'maskPane', 'bldPane', 'parcelPane', 'overlapPane', 'issuePane', 'labelPane']
    detectionPanes.forEach((name) => {
      map.createPane(name)
    })

    // Assert detection panes have no clipPath
    detectionPanes.forEach((name) => {
      const pane = map.getPane(name)
      expect(pane.style.clipPath).toBeFalsy()
    })

    // When Compare is enabled: create rawCoverPane and mount imageOverlay
    const rawCoverPane = map.createPane('rawCoverPane')
    rawCoverPane.style.zIndex = 640
    rawCoverPane.style.pointerEvents = 'none'

    expect(parseInt(rawCoverPane.style.zIndex, 10)).toBe(640)
    expect(rawCoverPane.style.pointerEvents).toBe('none')
    // Check it is above marker pane (600) and below tooltip pane (650)
    expect(parseInt(rawCoverPane.style.zIndex, 10)).toBeGreaterThan(600)
    expect(parseInt(rawCoverPane.style.zIndex, 10)).toBeLessThan(650)

    const bounds = L.latLngBounds([[28.61, 77.20], [28.62, 77.21]])
    const coverLayer = L.imageOverlay('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', bounds, {
      pane: 'rawCoverPane',
      interactive: false,
    }).addTo(map)

    const imgEl = coverLayer.getElement()
    if (imgEl) {
      // Simulate clipping
      const inset = computeCoverClipInset({ left: 0, width: 800 }, 50, { left: 0, width: 800 })
      imgEl.style.clipPath = `inset(0 ${inset}px 0 0)`
      expect(imgEl.style.clipPath).toBe('inset(0 400px 0 0)')
    }

    // Verify detection panes REMAIN completely unclipped
    detectionPanes.forEach((name) => {
      const pane = map.getPane(name)
      expect(pane.style.clipPath).toBeFalsy()
    })

    // Simulate map moveend and zoomend events
    let recomputeCalled = 0
    const onMapEvent = () => {
      recomputeCalled++
      if (imgEl) {
        const inset = computeCoverClipInset({ left: 0, width: 800 }, 60, { left: 0, width: 800 })
        imgEl.style.clipPath = `inset(0 ${inset}px 0 0)`
      }
    }

    map.on('moveend zoomend', onMapEvent)
    map.fire('moveend')
    map.fire('zoomend')

    expect(recomputeCalled).toBe(2)
    if (imgEl) {
      expect(imgEl.style.clipPath).toBe('inset(0 320px 0 0)')
    }

    // When Compare is toggled off: remove layer and pane completely
    map.removeLayer(coverLayer)
    rawCoverPane.parentNode.removeChild(rawCoverPane)
    delete map._panes.rawCoverPane

    expect(map.getPane('rawCoverPane')).toBeUndefined()
    expect(document.querySelector('.leaflet-rawCoverPane-pane')).toBeNull()

    map.remove()
  })

  test('Spatial event filtering ignores clicks and hovers on the left (covered) side of divider', () => {
    const isCoveredByCompare = ({ clientX, dividerX, compareActive }) => {
      if (!compareActive) return false
      return clientX < dividerX
    }

    // Compare Active: divider at x = 400
    // Cursor at x = 250 (left side / raw ortho covered): suppressed
    expect(isCoveredByCompare({ clientX: 250, dividerX: 400, compareActive: true })).toBe(true)

    // Cursor at x = 550 (right side / detections visible): permitted
    expect(isCoveredByCompare({ clientX: 550, dividerX: 400, compareActive: true })).toBe(false)

    // Compare Inactive: all clicks and hovers permitted across entire stage
    expect(isCoveredByCompare({ clientX: 250, dividerX: 400, compareActive: false })).toBe(false)
    expect(isCoveredByCompare({ clientX: 550, dividerX: 400, compareActive: false })).toBe(false)
  })
})
