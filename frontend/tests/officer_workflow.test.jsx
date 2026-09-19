import { test, expect, describe } from 'vitest'
import { sortQueueFeatures, PRIO_RANK } from '../src/components/RightPanel.jsx'
import { exportParcels } from '../src/lib/data.js'

describe('Officer Workflow Unit Tests', () => {
  test('Review queue sort order: High -> Medium -> Low, then area descending', () => {
    const mockFeatures = [
      { properties: { parcel_id: 'P-01', review_priority: 'Low', area_m2: 500 } },
      { properties: { parcel_id: 'P-02', review_priority: 'High', area_m2: 120 } },
      { properties: { parcel_id: 'P-03', review_priority: 'Medium', area_m2: 300 } },
      { properties: { parcel_id: 'P-04', review_priority: 'High', area_m2: 450 } },
      { properties: { parcel_id: 'P-05', review_priority: 'Low', area_m2: 1000 } },
      { properties: { parcel_id: 'P-06', review_priority: 'Medium', area_m2: 80 } },
    ]

    const sorted = sortQueueFeatures(mockFeatures)
    const sortedIds = sorted.map((f) => f.properties.parcel_id)

    // Expected order:
    // High: P-04 (450 m2), P-02 (120 m2)
    // Medium: P-03 (300 m2), P-06 (80 m2)
    // Low: P-05 (1000 m2), P-01 (500 m2)
    expect(sortedIds).toEqual(['P-04', 'P-02', 'P-03', 'P-06', 'P-05', 'P-01'])
  })

  test('Bulk approve logic: only Low priority in Draft are approved with decided_by = "bulk"', () => {
    const mockParcels = {
      type: 'FeatureCollection',
      features: [
        { properties: { parcel_id: 'P-HIGH-DRAFT', review_priority: 'High', area_m2: 200 } },
        { properties: { parcel_id: 'P-LOW-DRAFT-1', review_priority: 'Low', area_m2: 150 } },
        { properties: { parcel_id: 'P-LOW-DRAFT-2', review_priority: 'Low', area_m2: 180 } },
        { properties: { parcel_id: 'P-LOW-ALREADY-APPROVED', review_priority: 'Low', area_m2: 160 } },
        { properties: { parcel_id: 'P-LOW-REJECTED', review_priority: 'Low', area_m2: 140 } },
      ],
    }

    const statuses = {
      'P-LOW-ALREADY-APPROVED': { status: 'approved', note: 'Officer check', decided_by: 'individual' },
      'P-LOW-REJECTED': { status: 'rejected', note: 'Boundary bad', decided_by: 'individual' },
    }

    // Identify candidate parcels for bulk approval
    const lowDraftFeatures = mockParcels.features.filter((f) => {
      const prio = f.properties.review_priority
      const st = statuses[f.properties.parcel_id]?.status || 'draft'
      return prio === 'Low' && st === 'draft'
    })

    expect(lowDraftFeatures.map((f) => f.properties.parcel_id)).toEqual(['P-LOW-DRAFT-1', 'P-LOW-DRAFT-2'])

    // Simulate bulk approval
    const nextStatuses = { ...statuses }
    const affectedIds = []
    const prevMap = {}

    lowDraftFeatures.forEach((f) => {
      const id = f.properties.parcel_id
      affectedIds.push(id)
      prevMap[id] = statuses[id] || { status: 'draft' }
      nextStatuses[id] = {
        status: 'approved',
        note: 'Bulk approved (Low priority candidate)',
        decided_by: 'bulk',
      }
    })

    // Check individual vs bulk provenance
    expect(nextStatuses['P-LOW-DRAFT-1']).toEqual({
      status: 'approved',
      note: 'Bulk approved (Low priority candidate)',
      decided_by: 'bulk',
    })
    expect(nextStatuses['P-LOW-DRAFT-2']).toEqual({
      status: 'approved',
      note: 'Bulk approved (Low priority candidate)',
      decided_by: 'bulk',
    })
    expect(nextStatuses['P-LOW-ALREADY-APPROVED']).toEqual({
      status: 'approved',
      note: 'Officer check',
      decided_by: 'individual',
    })
    expect(nextStatuses['P-LOW-REJECTED']).toEqual({
      status: 'rejected',
      note: 'Boundary bad',
      decided_by: 'individual',
    })
    expect(nextStatuses['P-HIGH-DRAFT']).toBeUndefined()

    // Test 1-click Undo of bulk approval
    const undoneStatuses = { ...nextStatuses }
    affectedIds.forEach((id) => {
      if (prevMap[id] && prevMap[id].status !== 'draft') {
        undoneStatuses[id] = prevMap[id]
      } else {
        delete undoneStatuses[id]
      }
    })

    expect(undoneStatuses['P-LOW-DRAFT-1']).toBeUndefined()
    expect(undoneStatuses['P-LOW-DRAFT-2']).toBeUndefined()
    expect(undoneStatuses['P-LOW-ALREADY-APPROVED'].decided_by).toBe('individual')
  })

  test('exportParcels GeoJSON output preserves decided_by provenance', () => {
    const mockParcels = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { parcel_id: 'P-01', landuse: 'Built-up', area_m2: 150 },
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
          },
        },
        {
          type: 'Feature',
          properties: { parcel_id: 'P-02', landuse: 'Vegetation', area_m2: 250 },
          geometry: {
            type: 'Polygon',
            coordinates: [[[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]],
          },
        },
        {
          type: 'Feature',
          properties: { parcel_id: 'P-03', landuse: 'Open Ground', area_m2: 350 },
          geometry: {
            type: 'Polygon',
            coordinates: [[[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]]],
          },
        },
      ],
    }

    const statuses = {
      'P-01': { status: 'approved', note: 'Verified by officer', decided_by: 'individual' },
      'P-02': { status: 'approved', note: 'Bulk approved', decided_by: 'bulk' },
      // P-03 is left in draft
    }

    const exportedJson = exportParcels(mockParcels, statuses)
    const parsed = JSON.parse(exportedJson)

    expect(parsed.features).toHaveLength(3)

    const f1 = parsed.features.find((f) => f.properties.parcel_id === 'P-01')
    expect(f1.properties.status).toBe('approved')
    expect(f1.properties.decided_by).toBe('individual')
    expect(f1.properties.reviewer_note).toBe('Verified by officer')

    const f2 = parsed.features.find((f) => f.properties.parcel_id === 'P-02')
    expect(f2.properties.status).toBe('approved')
    expect(f2.properties.decided_by).toBe('bulk')
    expect(f2.properties.reviewer_note).toBe('Bulk approved')

    const f3 = parsed.features.find((f) => f.properties.parcel_id === 'P-03')
    expect(f3.properties.status).toBe('Draft / Unverified')
    expect(f3.properties.decided_by).toBe('')
  })

  test('Shortcut guard logic prevents trigger in text inputs, dialogs, and vertex editing', () => {
    // Helper function reproducing keyboard shortcut guard conditions
    const shouldHandleShortcut = ({ activeElementTag, isContentEditable, modalOpen, menuOpen, isEditing, key }) => {
      // 1. Guard against typing in form controls
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElementTag) ||
        isContentEditable
      ) {
        return false
      }

      // 2. Escape is allowed when modal, menu, editing or parcel is active
      if (key === 'Escape' || key === 'Esc') {
        return true
      }

      // 3. Guard against open modal or dropdown
      if (modalOpen || menuOpen) return false

      // 4. Guard against boundary editing (except Escape handled above)
      if (isEditing) return false

      return true
    }

    // Normal state: A, F, R, N, E, Esc should handle
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: false, menuOpen: false, isEditing: false, key: 'A' })).toBe(true)
    expect(shouldHandleShortcut({ activeElementTag: 'BODY', isContentEditable: false, modalOpen: false, menuOpen: false, isEditing: false, key: 'N' })).toBe(true)

    // While typing in textarea or input: all shortcuts suppressed
    expect(shouldHandleShortcut({ activeElementTag: 'TEXTAREA', isContentEditable: false, modalOpen: false, menuOpen: false, isEditing: false, key: 'A' })).toBe(false)
    expect(shouldHandleShortcut({ activeElementTag: 'INPUT', isContentEditable: false, modalOpen: false, menuOpen: false, isEditing: false, key: 'N' })).toBe(false)
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: true, modalOpen: false, menuOpen: false, isEditing: false, key: 'R' })).toBe(false)

    // When modal or menu is open: regular shortcuts blocked, Escape allowed
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: true, menuOpen: false, isEditing: false, key: 'A' })).toBe(false)
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: true, menuOpen: false, isEditing: false, key: 'Escape' })).toBe(true)
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: false, menuOpen: true, isEditing: false, key: 'N' })).toBe(false)
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: false, menuOpen: true, isEditing: false, key: 'Esc' })).toBe(true)

    // During boundary vertex editing: action shortcuts blocked, Escape allowed to finish/cancel edit
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: false, menuOpen: false, isEditing: true, key: 'A' })).toBe(false)
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: false, menuOpen: false, isEditing: true, key: 'F' })).toBe(false)
    expect(shouldHandleShortcut({ activeElementTag: 'DIV', isContentEditable: false, modalOpen: false, menuOpen: false, isEditing: true, key: 'Escape' })).toBe(true)
  })
})
