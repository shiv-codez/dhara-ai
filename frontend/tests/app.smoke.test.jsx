// Smoke test: mounts the real app against the real published data (public/data) in jsdom and
// walks through the main user flow. Catches runtime errors a production build cannot.
import { test, expect, beforeAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import React from 'react'

afterEach(() => cleanup())
const DATA = path.resolve(__dirname, '../public/data')

beforeAll(() => {
  // jsdom lacks SVG geometry; Leaflet only checks this one method to enable its vector renderer
  window.SVGElement.prototype.createSVGRect = () => ({})
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 900 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 700 })
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  global.fetch = vi.fn(async (url) => {
    const f = path.join(DATA, String(url).replace(/^.*\/data\//, ''))
    const body = fs.readFileSync(f, 'utf8')
    return { ok: true, json: async () => JSON.parse(body) }
  })
  URL.createObjectURL = () => 'blob:x'
})

test('app loads a scene, walks the steps, reviews a parcel', async () => {
  const errors = []
  vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')))
  const { default: App } = await import('../src/App.jsx')
  render(<App />)

  await waitFor(() => expect(screen.getByText('Play the pipeline')).toBeTruthy(), { timeout: 8000 })

  const stepBtn = (i) => document.querySelectorAll('.step-btn')[i]
  // step through every stage
  for (let i = 1; i < 8; i++) {
    fireEvent.click(stepBtn(i))
    await act(async () => {})
  }
  expect(screen.getByText(/Nothing here is a legal record/)).toBeTruthy()

  // regularisation + fix toggles
  fireEvent.click(stepBtn(3))
  fireEvent.click(screen.getByText('Raw mask outline'))
  fireEvent.click(screen.getByText('Cleaned polygons'))
  fireEvent.click(stepBtn(6))
  fireEvent.click(screen.getByText('Before auto-fix'))
  fireEvent.click(screen.getByText('After auto-fix'))

  // auto-play walkthrough starts and can be stopped
  fireEvent.click(screen.getByText('Play the pipeline'))
  await act(async () => {})
  fireEvent.click(screen.getByText('Stop walkthrough'))

  // tabs
  fireEvent.click(screen.getByText('Report'))
  expect(screen.getByText(/No reference polygons were supplied/)).toBeTruthy()
  fireEvent.click(screen.getByText('Checks'))
  fireEvent.click(screen.getByText('Parcel'))
  expect(screen.getByText('Select a parcel on the map.')).toBeTruthy()

  expect(errors.filter((e) => !/act\(/.test(e))).toEqual([])
})

test('parcel inspector: facts, decisions and boundary editing controls', async () => {
  const { default: RightPanel } = await import('../src/components/RightPanel.jsx')
  const man = JSON.parse(fs.readFileSync(path.join(DATA, 'village_tiled/manifest.json'), 'utf8'))
  const fc = JSON.parse(fs.readFileSync(path.join(DATA, 'village_tiled/parcels.geojson'), 'utf8'))
  const iss = JSON.parse(fs.readFileSync(path.join(DATA, 'village_tiled/issues.geojson'), 'utf8'))
  const calls = []
  const props = {
    tab: 'parcel', onTab() {}, manifest: man, parcel: fc.features[0], statuses: {}, audit: [],
    issues: iss.features, fixMode: 'after', onFocus() {}, editing: false, overlaps: [],
    onStatus: (...a) => calls.push(a), onEditStart: () => calls.push(['edit']), onEditDone() {}, onResolve() {},
    reviewed: 0, approved: 0, total: fc.features.length,
  }
  const { rerender } = render(<RightPanel {...props} />)
  expect(screen.getByText(/^Plot /)).toBeTruthy()
  fireEvent.click(screen.getByText('Approve'))
  fireEvent.click(screen.getByText('Needs field check'))
  fireEvent.click(screen.getByText('Edit boundary'))
  expect(calls.map((c) => c[1] || c[0])).toEqual(['approved', 'flagged', 'edit'])

  // live overlap warning appears while editing
  rerender(<RightPanel {...props} editing overlaps={[{ with: 'TMP-VI-0002', area: 3.4, feature: {} }]} />)
  expect(screen.getByText(/Overlap:/)).toBeTruthy()
  expect(screen.getByText(/Resolve: this plot gives up the overlap/)).toBeTruthy()

  // checks + report tabs render for real data
  rerender(<RightPanel {...props} tab="checks" />)
  expect(screen.getByText('Before')).toBeTruthy()
  rerender(<RightPanel {...props} tab="report" />)
  expect(screen.getByText(/Measured run time/)).toBeTruthy()
})
