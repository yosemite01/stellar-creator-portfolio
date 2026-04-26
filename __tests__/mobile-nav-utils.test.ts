import { describe, expect, it } from 'vitest'
import {
  MIN_TOUCH_TARGET_PX,
  shouldCloseMenuOnHorizontalSwipe,
  nextFocusIndex,
  collectFocusableElements,
} from '@/lib/utils/mobile-nav-utils'

describe('mobile-nav-utils', () => {
  it('exports 44px minimum touch target constant', () => {
    expect(MIN_TOUCH_TARGET_PX).toBe(44)
  })

  it('detects swipe-to-close threshold', () => {
    expect(shouldCloseMenuOnHorizontalSwipe(55)).toBe(false)
    expect(shouldCloseMenuOnHorizontalSwipe(56)).toBe(true)
    expect(shouldCloseMenuOnHorizontalSwipe(100)).toBe(true)
  })

  it('uses configurable threshold', () => {
    expect(shouldCloseMenuOnHorizontalSwipe(30, 30)).toBe(true)
  })

  it('steps focus index with wrap', () => {
    expect(nextFocusIndex(0, 1, 3)).toBe(1)
    expect(nextFocusIndex(2, 1, 3)).toBe(0)
    expect(nextFocusIndex(0, -1, 3)).toBe(2)
    expect(nextFocusIndex(0, 1, 0)).toBe(-1)
  })
})

describe('collectFocusableElements', () => {
  it('returns links and buttons in DOM order', () => {
    document.body.innerHTML = `
      <div id="box">
        <a href="/x">First</a>
        <button type="button">Second</button>
        <span tabindex="0">Third</span>
      </div>
    `
    const box = document.getElementById('box')
    const els = collectFocusableElements(box)
    expect(els).toHaveLength(3)
    expect(els[0]?.tagName).toBe('A')
    expect(els[1]?.tagName).toBe('BUTTON')
  })

  it('skips tabindex=-1', () => {
    document.body.innerHTML = `<div id="box"><button tabindex="-1">x</button><a href="/">y</a></div>`
    const box = document.getElementById('box')
    const els = collectFocusableElements(box)
    expect(els).toHaveLength(1)
  })

  it('collects many focusables quickly', () => {
    const links = Array.from({ length: 120 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    document.body.innerHTML = `<div id="big">${links}</div>`
    const box = document.getElementById('big')
    const t0 = performance.now()
    const els = collectFocusableElements(box)
    const ms = performance.now() - t0
    expect(els).toHaveLength(120)
    expect(ms).toBeLessThan(80)
  })
})
