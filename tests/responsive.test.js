import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const linkGridSource = readFileSync(
  new URL('../src/components/LinkGrid.vue', import.meta.url),
  'utf8'
)
const settingsSource = readFileSync(
  new URL('../src/components/SettingsPanel.vue', import.meta.url),
  'utf8'
)

test('mobile header uses a compact action menu and keeps overlays scroll-locked', () => {
  assert.match(appSource, /class="mobile-header-actions"/)
  assert.match(appSource, /\.header-actions\s*\{\s*display:\s*none;/)
  assert.match(appSource, /html\.overlay-scroll-locked/)
  assert.match(appSource, /\.modal\s*\{[\s\S]*?height:\s*100dvh;/)
})

test('narrow screens use one card column and an explicit management menu', () => {
  assert.match(appSource, /@media \(max-width:\s*520px\)[\s\S]*?grid-template-columns:\s*1fr;/)
  assert.match(linkGridSource, /class="card-more"/)
  assert.match(linkGridSource, /\.card-actions\.open/)
  assert.match(linkGridSource, /@media \(max-width:\s*520px\)[\s\S]*?grid-template-columns:\s*1fr;/)
})

test('mobile settings use a section picker and full-width search fields', () => {
  assert.match(settingsSource, /class="mobile-settings-nav-trigger"/)
  assert.match(settingsSource, /\.settings-nav\s*\{\s*display:\s*none;/)
  assert.match(settingsSource, /\.search-source-row\s*\{[\s\S]*?display:\s*grid;/)
  assert.match(
    settingsSource,
    /\.search-source-row \.search-source-field\s*\{[\s\S]*?width:\s*100%;/
  )
  assert.match(settingsSource, /env\(safe-area-inset-bottom\)/)
})
