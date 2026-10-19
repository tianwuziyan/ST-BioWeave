import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const STYLE_SOURCE = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
const CONFIG = JSON.parse(readFileSync(new URL('../docs/ui-framework.config.json', import.meta.url), 'utf8'))
const FRAMEWORK_SOURCE = readFileSync(new URL('../docs/UI_FRAMEWORK.md', import.meta.url), 'utf8')
const EXAMPLE_SOURCE = readFileSync(new URL('../docs/UI_FRAMEWORK_EXAMPLE.html', import.meta.url), 'utf8')

function cssBlocks(source, selector) {
  return [...source.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`, 'g'))]
    .map(match => ({index: match.index, source: match[0]}))
}

test('health source menu stays in the popover scroll flow and above nearby content', () => {
  const popoverBlocks = cssBlocks(STYLE_SOURCE, '.bioweave-character-health-popover')
  const sourceBlocks = cssBlocks(STYLE_SOURCE, '.bioweave-character-health-source-list')
  const popover = popoverBlocks.find(block => block.source.includes('overflow-y: auto'))
  const sourceMenu = sourceBlocks.at(-1)
  const mobilePopover = popoverBlocks.find(block => block.index > popover?.index && block.source.includes('position: fixed'))

  assert.ok(popover)
  assert.ok(sourceMenu)
  assert.ok(mobilePopover)
  assert.match(popover.source, /z-index:\s*8\s*!important/u)
  assert.match(sourceMenu.source, /position:\s*relative\s*!important/u)
  assert.doesNotMatch(sourceMenu.source, /position:\s*absolute/u)
  assert.match(sourceMenu.source, /z-index:\s*9\s*!important/u)
  assert.match(sourceMenu.source, /top:\s*auto\s*!important/u)
  assert.match(sourceMenu.source, /right:\s*auto\s*!important/u)
  assert.match(sourceMenu.source, /width:\s*auto\s*!important/u)
  assert.match(mobilePopover.source, /position:\s*fixed\s*!important/u)
  assert.match(mobilePopover.source, /bottom:\s*10px\s*!important/u)
  assert.ok(mobilePopover.index > popover.index)
})

test('health popup framework contract stays synchronized across config, guide, and example', () => {
  const healthPopover = CONFIG.components.charactersPage.detail.healthStatusPopover

  assert.deepEqual(healthPopover.layering, {
    popoverZIndex: 8,
    sourceMenuZIndex: 9,
    sourceMenuPosition: 'relative normal flow inside the scrollable health popover',
    overflow: 'source list contributes to the popover scroll area; no absolute child escape',
  })
  assert.match(FRAMEWORK_SOURCE, /bioweave-character-health-source-list` 保持在正常滚动流中/u)
  assert.match(EXAMPLE_SOURCE, /\.bw-character-health-popover \{[^}]*z-index: 8;[^}]*overflow-y: auto;/u)
  assert.match(EXAMPLE_SOURCE, /\.bw-character-health-source-list \{[^}]*position: relative;[^}]*z-index: 9;[^}]*width: auto;/u)
  assert.doesNotMatch(EXAMPLE_SOURCE, /\.bw-character-health-source-list \{[^}]*position: absolute/u)
})
