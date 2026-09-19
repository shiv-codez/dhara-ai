import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { backupSaved, exportLabelsFromBackup, loadSaved } from '../src/lib/data.js'

afterEach(() => cleanup())

const DATA = path.resolve(__dirname, '../public/data')

describe('Data Fingerprint & Review State Invalidation', () => {
  beforeEach(() => {
    localStorage.clear()
    window.SVGElement.prototype.createSVGRect = () => ({})
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 900 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 700 })
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    global.fetch = vi.fn(async (url) => {
      const f = path.join(DATA, String(url).replace(/^.*\/data\//, ''))
      const body = fs.readFileSync(f, 'utf8')
      return { ok: true, json: async () => JSON.parse(body) }
    })
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  test('backupSaved sets timestamped backup key and clears active key', () => {
    const sceneId = 'test_scene'
    const savedData = {
      fingerprint: 'old_hash_123',
      statuses: { 'TMP-01': { status: 'approved', decided_by: 'individual' } },
      audit: [{ at: '2026-09-19T10:00:00Z', what: 'Approve' }],
      edits: {},
    }

    localStorage.setItem(`dhara:v1:${sceneId}`, JSON.stringify(savedData))
    expect(loadSaved(sceneId)).toEqual(savedData)

    const result = backupSaved(sceneId, savedData)
    expect(result).not.toBeNull()
    expect(result.backupKey).toMatch(/^dhara:v1:test_scene:backup:\d+$/)
    expect(result.data).toEqual(savedData)

    // Active key should be cleared
    expect(loadSaved(sceneId)).toEqual({})

    // Backup key should hold the original data
    const backedUp = JSON.parse(localStorage.getItem(result.backupKey))
    expect(backedUp).toEqual(savedData)
  })

  test('exportLabelsFromBackup exports valid training records with radiometric features', () => {
    const backupObj = {
      fingerprint: 'old_hash_123',
      statuses: {
        'TMP-01': { status: 'approved', decided_by: 'individual' },
        'TMP-02': { status: 'rejected', decided_by: 'bulk' },
        'TMP-03': { status: 'draft' },
      },
      featureSnapshots: {
        'TMP-01': {
          building_id: 'B-0001',
          veg_frac: 0.05,
          sat: 0.45,
          val: 0.8,
          hue: 25,
          rect: 0.9,
          solidity: 0.95,
          area_m2: 120,
          ground_likeness: 0.1,
        },
      },
    }

    const currentParcels = {
      type: 'FeatureCollection',
      features: [
        {
          properties: {
            parcel_id: 'TMP-02',
            building_id: 'B-0002',
            veg_frac: 0.7,
            sat: 0.1,
            val: 0.2,
            hue: 100,
            rect: 0.3,
            solidity: 0.4,
            area_m2: 50,
            ground_likeness: 0.85,
          },
        },
      ],
    }

    const exportedStr = exportLabelsFromBackup('test_scene', backupObj, currentParcels)
    const records = JSON.parse(exportedStr)

    expect(records).toHaveLength(2)

    const r1 = records.find((r) => r.parcel_id === 'TMP-01')
    expect(r1.label).toBe('building')
    expect(r1.decided_by).toBe('individual')
    expect(r1.features.veg_frac).toBe(0.05)
    expect(r1.features.solidity).toBe(0.95)

    const r2 = records.find((r) => r.parcel_id === 'TMP-02')
    expect(r2.label).toBe('not_building')
    expect(r2.decided_by).toBe('bulk')
    expect(r2.features.ground_likeness).toBe(0.85)
  })

  test('App: matches fingerprint -> loads saved state normally without invalidation banner', async () => {
    const realManifest = JSON.parse(fs.readFileSync(path.join(DATA, 'village_tiled/manifest.json'), 'utf8'))
    const fp = realManifest.data_fingerprint

    // Pre-populate localStorage with matching fingerprint
    const savedState = {
      fingerprint: fp,
      statuses: {
        'TMP-VI-0001': { status: 'approved', decided_by: 'individual', note: 'Checked' },
      },
      audit: [{ at: '2026-09-19T10:00:00Z', what: 'Approve TMP-VI-0001' }],
      edits: {},
    }
    localStorage.setItem('dhara:v1:village_tiled', JSON.stringify(savedState))

    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    await waitFor(() => expect(screen.getByText('Play the pipeline')).toBeTruthy(), { timeout: 8000 })

    // Invalidation banner should NOT be present
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/The map data for this scene was regenerated/)).toBeNull()

    // Status is applied: progress header shows 1 approved
    await waitFor(() => {
      expect(screen.getByTitle('1 approved')).toBeTruthy()
    })
  })

  test('App: mismatched fingerprint -> sets aside old state, backs it up, shows dismissible banner with backup export', async () => {
    // Pre-populate localStorage with DIFFERENT/STALE fingerprint
    const staleState = {
      fingerprint: 'stale_fingerprint_hash_old_99999',
      statuses: {
        'TMP-VI-0001': { status: 'approved', decided_by: 'individual' },
        'TMP-VI-0002': { status: 'rejected', decided_by: 'individual' },
      },
      audit: [{ at: '2026-09-19T10:00:00Z', what: 'Approve TMP-VI-0001' }],
      edits: {
        'TMP-VI-0001': { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      },
    }
    localStorage.setItem('dhara:v1:village_tiled', JSON.stringify(staleState))

    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    await waitFor(() => expect(screen.getByText('Play the pipeline')).toBeTruthy(), { timeout: 8000 })

    // Invalidation banner MUST appear
    const banner = await screen.findByRole('alert')
    expect(banner).toBeTruthy()
    expect(screen.getByText(/The map data for this scene was regenerated, so 2 earlier decisions were set aside\./)).toBeTruthy()

    // Old review state should NOT be active on parcels (0 approved)
    expect(screen.getByTitle('0 approved')).toBeTruthy()

    // Verify backup in localStorage
    const keys = Object.keys(localStorage)
    const backupKey = keys.find((k) => k.startsWith('dhara:v1:village_tiled:backup:'))
    expect(backupKey).toBeTruthy()
    const backupContent = JSON.parse(localStorage.getItem(backupKey))
    expect(backupContent.statuses['TMP-VI-0001'].status).toBe('approved')

    // "Export old review labels" button works
    const exportBtn = screen.getByText('Export old review labels')
    expect(exportBtn).toBeTruthy()
    fireEvent.click(exportBtn)
    expect(URL.createObjectURL).toHaveBeenCalled()

    // Dismiss banner
    const dismissBtn = screen.getByLabelText('Dismiss banner')
    fireEvent.click(dismissBtn)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
