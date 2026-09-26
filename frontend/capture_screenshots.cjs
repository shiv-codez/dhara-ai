const path = require('path')
const fs = require('fs')

let playwright
try {
  playwright = require('C:/Users/shiva/AppData/Roaming/npm/node_modules/@playwright/test/node_modules/playwright')
} catch (e1) {
  try {
    playwright = require('C:/Users/shiva/AppData/Roaming/npm/node_modules/playwright')
  } catch (e2) {
    console.error('Failed to load playwright from global node_modules:', e1, e2)
    process.exit(1)
  }
}

const { chromium } = playwright

async function run() {
  const outDir = path.resolve(__dirname, 'screenshots')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  console.log('Launching browser...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  // Set localStorage to dismiss hint so it never blocks views
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dhara:v1:onboarding_dismissed', 'true')
    } catch (e) {}
  })

  console.log('Navigating to http://localhost:5173...')
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

  // Wait for map and app to be fully rendered
  await page.waitForTimeout(1500)

  // 1. Click Fit View to show the entire orthomosaic with surrounding blueprint grid gutter
  console.log('Capturing Map View with blueprint grid gutter (Fit View)...')
  const fitBtn = page.locator('button[title*="Fit view"], button:has-text("Fit view")')
  if (await fitBtn.count() > 0) {
    await fitBtn.click()
    await page.waitForTimeout(600)
  }
  await page.screenshot({ path: path.join(outDir, '01_map_view_fit_gutter.png') })

  // 2. Switch to Table & Dashboard View
  console.log('Switching to Table & Dashboard View...')
  const tableToggle = page.locator('.view-mode-btn').filter({ hasText: /Table|तालिका/ })
  await tableToggle.click()
  await page.waitForTimeout(1000)

  // Screenshot Table & Dashboard View
  console.log('Capturing Table View...')
  await page.screenshot({ path: path.join(outDir, '02_table_view.png') })

  // 3. Switch to town_dense scene (145 parcels)
  console.log('Switching to town_dense scene (145 parcels)...')
  const sceneSelect = page.locator('.scene-pick select, select').first()
  if (await sceneSelect.count() > 0) {
    await sceneSelect.selectOption({ value: 'town_dense' })
    await page.waitForTimeout(1500)
  }

  // 4. Capture Table View for town_dense
  console.log('Capturing town_dense Table View...')
  await page.screenshot({ path: path.join(outDir, '03_table_view_town_dense.png') })

  // 5. In town_dense table view, click "Inspect on Map" on plot row 5
  console.log('Clicking Inspect on Map for town_dense plot and capturing mid-glow...')
  const inspectBtns = page.locator('.table-action-btn.inspect-btn')
  if (await inspectBtns.count() > 4) {
    // Click inspect button for 5th parcel
    await inspectBtns.nth(4).click()
    // Wait ~200ms so Leaflet fits bounds and boundary glow animation is mid-flight (animation lasts 1.5s)
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(outDir, '04_inspect_town_dense_midglow.png') })
  }

  // 6. Wait for animation to finish and capture settled state
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(outDir, '05_inspect_town_dense_settled.png') })

  // 7. Switch language to Hindi
  console.log('Switching to Hindi...')
  const hiBtn = page.locator('.lang-btn:has-text("हि")')
  await hiBtn.click()
  await page.waitForTimeout(800)

  // Screenshot Map View in Hindi
  console.log('Capturing Map View Hindi...')
  await page.screenshot({ path: path.join(outDir, '06_map_view_hindi.png') })

  // 8. Switch back to English and capture dedicated Header Bar screenshot
  console.log('Switching back to EN and capturing header bar...')
  const enBtn = page.locator('.lang-btn:has-text("EN")')
  await enBtn.click()
  await page.waitForTimeout(500)
  const headerElement = page.locator('.top')
  await headerElement.screenshot({ path: path.join(outDir, '07_header_bar.png') })

  await browser.close()
  console.log('All screenshots captured successfully in', outDir)
}

run().catch((err) => {
  console.error('Error capturing screenshots:', err)
  process.exit(1)
})
