import { test, expect, describe, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReportTab } from '../src/components/RightPanel.jsx'

describe('Ground-Truth Check UI Unit Tests', () => {
  const mockManifest = {
    size_px: [1000, 1000],
    gsd_m: 0.05,
    area_ha: 1.2,
    crs: 'EPSG:32643',
    model: 'MobileSAM',
    counts: {
      buildings: 75,
      parcels: 40,
      road_corridors: 5,
    },
    coverage: {
      building_pct: 25,
      road_pct: 15,
      vegetation_pct: 30,
    },
  }

  test('Honesty default: displays unverified callout and no accuracy numbers when no reference is loaded', () => {
    render(
      <ReportTab
        manifest={mockManifest}
        sceneId="village_tiled"
        groundTruthResult={null}
        referenceSource={null}
        referenceError={null}
        onLoadReferenceFile={vi.fn()}
        onLoadSampleReference={vi.fn()}
        onClearReference={vi.fn()}
        hasSampleReference={true}
      />
    )

    // Verify Honesty Notice is present
    expect(screen.getByText(/No reference polygons were supplied for this scene, so no accuracy figure is shown/i)).toBeTruthy()
    // Verify sample reference button is rendered for village_tiled
    expect(screen.getByText(/Load sample reference \(55 buildings\)/i)).toBeTruthy()
    // Verify Upload button is rendered
    expect(screen.getByText(/Upload reference GeoJSON/i)).toBeTruthy()
    // Ensure no F1 / precision metric cards are rendered yet
    expect(screen.queryByText(/F1 Score/i)).toBeNull()
  })

  test('Verified state: displays test conditions, metrics grid, boundary offset, and breakdown list', () => {
    const mockGtResult = {
      summary: {
        n_pred: 75,
        n_gt: 55,
        tp: 42,
        fp: 33,
        fn: 13,
        precision: 0.56,
        recall: 0.7636,
        f1: 0.6462,
        mean_matched_iou: 0.725,
        boundary_offset: {
          mean_m: 0.42,
          median_m: 0.35,
          p90_m: 0.88,
          rmse_m: 0.51,
        },
        iou_threshold: 0.5,
      },
      layers: {
        tp: { type: 'FeatureCollection', features: [] },
        fp: { type: 'FeatureCollection', features: [] },
        fn: { type: 'FeatureCollection', features: [] },
      },
    }

    const mockClear = vi.fn()

    render(
      <ReportTab
        manifest={mockManifest}
        sceneId="village_tiled"
        groundTruthResult={mockGtResult}
        referenceSource={{ name: 'village_tiled 55 reference buildings', count: 55 }}
        referenceError={null}
        onLoadReferenceFile={vi.fn()}
        onLoadSampleReference={vi.fn()}
        onClearReference={mockClear}
        hasSampleReference={true}
      />
    )

    // Reference Layer Active banner
    expect(screen.getByText(/Reference Layer Active/i)).toBeTruthy()
    expect(screen.getByText(/55 reference buildings/i)).toBeTruthy()

    // Test Conditions
    expect(screen.getByText(/Test conditions/i)).toBeTruthy()
    expect(screen.getAllByText('55').length).toBeGreaterThan(0)
    expect(screen.getAllByText('75').length).toBeGreaterThan(0)

    // Scorecard Metrics
    expect(screen.getByText(/Precision/i)).toBeTruthy()
    expect(screen.getByText('56.0%')).toBeTruthy()
    expect(screen.getByText(/Recall/i)).toBeTruthy()
    expect(screen.getByText('76.4%')).toBeTruthy()
    expect(screen.getByText(/F1 Score/i)).toBeTruthy()
    expect(screen.getByText('64.6%')).toBeTruthy()
    expect(screen.getByText(/Mean Matched IoU/i)).toBeTruthy()
    expect(screen.getByText('72.5%')).toBeTruthy()

    // Boundary Offset
    expect(screen.getByText(/0.42 m/i)).toBeTruthy()
    expect(screen.getByText(/0.88 m/i)).toBeTruthy()

    // Classification breakdown
    expect(screen.getByText(/42 Matched buildings/i)).toBeTruthy()
    expect(screen.getByText(/33 False positive candidates/i)).toBeTruthy()
    expect(screen.getByText(/13 Missed reference buildings/i)).toBeTruthy()

    // Clear reference action
    const clearBtn = screen.getByRole('button', { name: /Clear reference/i })
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn)
    expect(mockClear).toHaveBeenCalledTimes(1)
  })
})
