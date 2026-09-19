import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest'
import JSZip from 'jszip'
import { importResultsZip } from '../src/lib/importZip.js'
import { getParcelTooltipHtml } from '../src/lib/hoverController.js'
import { escapeHtml } from '../src/lib/sanitize.js'
import { loadSaved, saveSaved } from '../src/lib/data.js'

describe('Task 5: Import Results & Untrusted ZIP Security', () => {
  beforeEach(() => {
    localStorage.clear()
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url-' + Math.random().toString(36).slice(2))
    global.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Helper to build a minimal valid manifest
  function makeValidManifest(overrides = {}) {
    return {
      schema_version: 1,
      scene: 'village_test',
      title: 'Village Test Scene',
      description: 'Test description',
      bounds: [28.6139, 77.209, 28.615, 77.21],
      size_px: [1000, 1000],
      gsd_m: 0.05,
      crs: 'EPSG:32643',
      georef_source: 'assumed_demo',
      area_ha: 1.25,
      data_fingerprint: 'fp_village_test_12345678',
      model: 'MobileSAM',
      counts: { parcels: 1, buildings: 1 },
      ...overrides,
    }
  }

  // Helper to build a minimal valid parcels FeatureCollection
  function makeValidParcels(features = null) {
    return {
      type: 'FeatureCollection',
      features: features || [
        {
          type: 'Feature',
          properties: {
            parcel_id: 'VIL-0001',
            area_m2: 150.5,
            landuse: 'Built-up',
            review_priority: 'Low',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [77.209, 28.6139],
                [77.21, 28.6139],
                [77.21, 28.615],
                [77.209, 28.615],
                [77.209, 28.6139],
              ],
            ],
          },
        },
      ],
    }
  }

  // 1. Pack then import round trip
  test('valid results zip imports successfully and returns structured scene', async () => {
    const zip = new JSZip()
    const manifest = makeValidManifest()
    const parcels = makeValidParcels()

    zip.file('manifest.json', JSON.stringify(manifest))
    zip.file('parcels.geojson', JSON.stringify(parcels))
    zip.file('ortho.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))
    zip.file('masks.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    zip.file('segments.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    zip.file('village_test_dhara_candidates.gpkg', new Uint8Array([1, 2, 3, 4]))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    const scene = await importResultsZip(buffer)

    expect(scene.imported).toBe(true)
    expect(scene.title).toBe('Village Test Scene (imported)')
    expect(scene.manifest.schema_version).toBe(1)
    expect(scene.manifest.data_fingerprint).toBe('fp_village_test_12345678')
    expect(scene.manifest.georef_source).toBe('assumed_demo')
    expect(scene.data.parcels.features).toHaveLength(1)
    expect(scene.urls.ortho).toBeDefined()
    expect(scene.urls.masks).toBeDefined()
    expect(scene.urls.segments).toBeDefined()
    expect(scene.urls.gpkg).toBeDefined()

    // Test cleanup revokes all URLs
    scene.cleanup()
    expect(global.URL.revokeObjectURL).toHaveBeenCalled()
  })

  // 2. Reject path traversal and directory nesting
  test('rejects path traversal (..) in zip entries', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest()))
    zip.file('parcels.geojson', JSON.stringify(makeValidParcels()))
    zip.file('../evil.txt', 'malicious')

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/traversal|nested|illegal/i)
  })

  test('rejects nested folder entries', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest()))
    zip.file('nested/parcels.geojson', JSON.stringify(makeValidParcels()))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/nested or illegal file path/i)
  })

  // 3. Reject unexpected / unwhitelisted files
  test('rejects unexpected file names', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest()))
    zip.file('parcels.geojson', JSON.stringify(makeValidParcels()))
    zip.file('payload.exe', 'binary')

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/unexpected file in archive/i)
  })

  // 4. Reject missing manifest or missing parcels
  test('rejects archive missing manifest.json', async () => {
    const zip = new JSZip()
    zip.file('parcels.geojson', JSON.stringify(makeValidParcels()))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/missing required "manifest.json"/i)
  })

  test('rejects archive missing parcels.geojson', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest()))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/missing required "parcels.geojson"/i)
  })

  // 5. Manifest validation tests
  test('rejects manifest with invalid schema_version', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest({ schema_version: 0 })))
    zip.file('parcels.geojson', JSON.stringify(makeValidParcels()))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/schema_version/i)
  })

  test('rejects manifest with missing data_fingerprint', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest({ data_fingerprint: '' })))
    zip.file('parcels.geojson', JSON.stringify(makeValidParcels()))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/data_fingerprint/i)
  })

  test('rejects manifest with out-of-range bounds coordinates', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest({ bounds: [120, 77.209, 130, 77.21] }))) // lat > 90
    zip.file('parcels.geojson', JSON.stringify(makeValidParcels()))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/latitude bounds/i)
  })

  test('rejects manifest with inverted bounds coordinates', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest({ bounds: [28.615, 77.209, 28.6139, 77.21] }))) // minLat > maxLat
    zip.file('parcels.geojson', JSON.stringify(makeValidParcels()))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/inverted bounds/i)
  })

  // 6. GeoJSON validation tests
  test('rejects GeoJSON with invalid coordinates outside WGS84 range', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest()))
    const badParcels = makeValidParcels([
      {
        type: 'Feature',
        properties: { parcel_id: 'BAD-01' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [250, 28.6139], // lon > 180
              [77.21, 28.6139],
              [77.21, 28.615],
              [250, 28.6139],
            ],
          ],
        },
      },
    ])
    zip.file('parcels.geojson', JSON.stringify(badParcels))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/outside valid WGS84 range/i)
  })

  test('rejects parcels missing parcel_id property', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(makeValidManifest()))
    const badParcels = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {}, // missing parcel_id
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [77.209, 28.6139],
                [77.21, 28.6139],
                [77.21, 28.615],
                [77.209, 28.6139],
              ],
            ],
          },
        },
      ],
    }
    zip.file('parcels.geojson', JSON.stringify(badParcels))

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(importResultsZip(buffer)).rejects.toThrow(/missing a valid "parcel_id"/i)
  })

  // 7. XSS sanitization audit test
  test('tooltip built from parcel with XSS payload renders escaped text only', () => {
    const maliciousProps = {
      parcel_id: '<script>alert(1)</script>9999',
      landuse: '<img src=x onerror=alert(1)>',
      review_priority: 'High<svg onload=alert(2)>',
      review_reasons: '<b>Injected</b> <iframe src="javascript:alert(3)"></iframe>',
      area_m2: 250,
    }

    const html = getParcelTooltipHtml(maliciousProps)

    // Verify raw unescaped HTML tags are NOT present
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<svg onload')
    expect(html).not.toContain('<iframe')

    // Verify escaped entity strings ARE present
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;iframe')
    expect(html).toContain('&lt;b&gt;Injected&lt;/b&gt;')
  })

  test('escapeHtml properly sanitizes entities', () => {
    expect(escapeHtml('<script>alert("XSS")</script>')).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;')
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#039;s')
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  // 8. Review state reattachment by data_fingerprint on re-import
  test('review state reattaches by data_fingerprint on re-import', async () => {
    const fingerprint = 'sha256_unique_demo_fingerprint_abc123'
    const manifest = makeValidManifest({ scene: 'test_demo', data_fingerprint: fingerprint })
    const parcels = makeValidParcels()

    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(manifest))
    zip.file('parcels.geojson', JSON.stringify(parcels))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    // Step A: First import
    const scene1 = await importResultsZip(buffer)
    expect(scene1.id).toBe('imported:test_demo')

    // Step B: Officer reviews a parcel
    const savedState = {
      fingerprint,
      statuses: {
        'VIL-0001': {
          status: 'approved',
          decided_by: 'individual',
          note: 'Surveyed on ground',
          t: new Date().toISOString(),
        },
      },
      audit: [{ at: new Date().toISOString(), what: 'Approve Plot 0001', decided_by: 'individual' }],
      edits: {},
      featureSnapshots: {},
    }
    saveSaved(scene1.id, savedState)

    // Check saved state in localStorage
    const retrieved1 = loadSaved(scene1.id)
    expect(retrieved1.fingerprint).toBe(fingerprint)
    expect(retrieved1.statuses['VIL-0001'].status).toBe('approved')

    // Step C: Re-import the exact same zip
    const scene2 = await importResultsZip(buffer)
    expect(scene2.id).toBe('imported:test_demo')

    // Check that loadSaved reattaches the review state because fingerprint matches
    const retrieved2 = loadSaved(scene2.id)
    expect(retrieved2.fingerprint).toBe(fingerprint)
    expect(retrieved2.statuses['VIL-0001'].status).toBe('approved')
    expect(retrieved2.statuses['VIL-0001'].note).toBe('Surveyed on ground')
  })
})
