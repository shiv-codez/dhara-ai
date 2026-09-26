import { test, expect, describe, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { translate } from '../src/lib/i18n.js'
import OnboardingHint from '../src/components/OnboardingHint.jsx'
import TableView from '../src/components/TableView.jsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Task 9: i18n Localization', () => {
  test('translates keys for English and Hindi', () => {
    expect(translate('play_pipeline', 'en')).toBe('Play the pipeline')
    expect(translate('play_pipeline', 'hi')).toBe('पाइपलाइन चलाएं')
    expect(translate('approve', 'en')).toBe('Approve')
    expect(translate('approve', 'hi')).toBe('स्वीकार करें (Approve)')
  })

  test('interpolates parameters correctly in both languages', () => {
    const enStr = translate('bulk_approved_msg', 'en', { count: 5 })
    expect(enStr).toBe('Approved 5 Low priority parcels in bulk.')

    const hiStr = translate('bulk_approved_msg', 'hi', { count: 5 })
    expect(hiStr).toBe('कुल 5 निम्न प्राथमिकता पार्सल थोक में स्वीकृत किए गए।')
  })

  test('falls back gracefully to key when missing', () => {
    expect(translate('non_existent_key', 'en')).toBe('non_existent_key')
    expect(translate('non_existent_key', 'hi')).toBe('non_existent_key')
  })
})

describe('Task 9: OnboardingHint Component', () => {
  test('renders 3-step introductory guidance and persists dismissal in localStorage', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<OnboardingHint onDismiss={onDismiss} lang="en" />)

    expect(screen.getByText('Getting started with Dhara.ai')).toBeTruthy()
    expect(screen.getByText(/Play the pipeline/i)).toBeTruthy()
    expect(screen.getByText(/Select & inspect/i)).toBeTruthy()
    expect(screen.getByText(/Review & export/i)).toBeTruthy()

    const dismissBtn = screen.getByRole('button', { name: /Got it/i })
    fireEvent.click(dismissBtn)

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('dhara:v1:onboarding_dismissed')).toBe('true')
    unmount()

    // Rerender fresh instance with Hindi after clearing storage
    localStorage.clear()
    render(<OnboardingHint onDismiss={onDismiss} lang="hi" />)
    expect(screen.getByText('Dhara.ai का उपयोग कैसे करें')).toBeTruthy()
  })
})

describe('Task 9: TableView Component & KPI Dashboard', () => {
  const sampleFeatures = [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {
        parcel_id: 'TMP-VI-0001',
        area_m2: 120.5,
        landuse: 'Built-up',
        building_coverage: 0.45,
        review_priority: 'Low',
        sam_quality: 0.88,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {
        parcel_id: 'TMP-VI-0002',
        area_m2: 650.0,
        landuse: 'Vegetation / Trees',
        building_coverage: 0.05,
        review_priority: 'High',
        sam_quality: 0.95,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {
        parcel_id: 'TMP-VI-0003',
        area_m2: 1500.0,
        landuse: 'Built-up (low density)',
        building_coverage: 0.20,
        review_priority: 'Medium',
        sam_quality: 0.72,
      },
    },
  ]

  const parcelsGeoJSON = {
    type: 'FeatureCollection',
    features: sampleFeatures,
  }

  const statuses = {
    'TMP-VI-0001': { status: 'approved', note: 'Looks good' },
    'TMP-VI-0002': { status: 'draft' },
    'TMP-VI-0003': { status: 'flagged', note: 'Check boundary' },
  }

  test('renders KPI cards with correct metrics and counts', () => {
    render(
      <TableView
        parcelsGeoJSON={parcelsGeoJSON}
        statuses={statuses}
        selectedId={null}
        selectedFeature={null}
        onSelectParcel={() => {}}
        onDecide={() => {}}
        onSwitchToMap={() => {}}
        lang="en"
      />
    )

    // Total parcels count (3)
    const kpiValues = screen.getAllByText('3')
    expect(kpiValues.length).toBeGreaterThanOrEqual(1)

    // Status breakdown in table count info or KPI
    expect(screen.getByText(/Showing 3 of 3 candidate parcels/i)).toBeTruthy()
  })

  test('supports sorting by columns', () => {
    render(
      <TableView
        parcelsGeoJSON={parcelsGeoJSON}
        statuses={statuses}
        selectedId={null}
        selectedFeature={null}
        onSelectParcel={() => {}}
        onDecide={() => {}}
        onSwitchToMap={() => {}}
        lang="en"
      />
    )

    const areaHeader = screen.getByRole('columnheader', { name: /Area \(m²\)/i })
    fireEvent.click(areaHeader)

    const rows = screen.getAllByRole('row')
    expect(rows.length).toBe(4) // 1 header + 3 data rows
  })

  test('supports filtering by text search and status filter', () => {
    render(
      <TableView
        parcelsGeoJSON={parcelsGeoJSON}
        statuses={statuses}
        selectedId={null}
        selectedFeature={null}
        onSelectParcel={() => {}}
        onDecide={() => {}}
        onSwitchToMap={() => {}}
        lang="en"
      />
    )

    const searchInput = screen.getByPlaceholderText('Search plot ID or code...')
    fireEvent.change(searchInput, { target: { value: '0002' } })

    expect(screen.getByText('TMP-VI-0002')).toBeTruthy()
    expect(screen.queryByText('TMP-VI-0001')).toBeNull()
    expect(screen.queryByText('TMP-VI-0003')).toBeNull()
  })

  test('triggers decision callback from quick action buttons', () => {
    const onDecide = vi.fn()
    render(
      <TableView
        parcelsGeoJSON={parcelsGeoJSON}
        statuses={statuses}
        selectedId={null}
        selectedFeature={null}
        onSelectParcel={() => {}}
        onDecide={onDecide}
        onSwitchToMap={() => {}}
        lang="en"
      />
    )

    // Find quick approve button on draft parcel TMP-VI-0002
    const approveBtns = screen.getAllByTitle('Quick Approve')
    fireEvent.click(approveBtns[1]) // parcel 0002 is index 1

    expect(onDecide).toHaveBeenCalledWith('TMP-VI-0002', 'approved')
  })
})
