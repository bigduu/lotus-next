import { expect, type Locator, type TestInfo } from "@playwright/test"

/** Observe the real layout; never repair a hidden ancestor's scroll position. */
export async function expectInspectorGeometry(panel: Locator, testInfo: TestInfo, phase: string) {
  const geometry = await panel.evaluate((section) => {
    const workbench = section.closest('#right-workbench')!
    const tabpanel = section.closest('[role="tabpanel"]')!
    const embedded = tabpanel.firstElementChild!
    const scroller = section.parentElement!
    const view = section.ownerDocument.defaultView!
    const rect = (node: typeof tabpanel) => {
      const { x, y, left, right, top, bottom, width, height } = node.getBoundingClientRect()
      return { x, y, left, right, top, bottom, width, height }
    }
    const measure = (node: typeof tabpanel) => ({
      rect: rect(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
      scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
      minWidth: view.getComputedStyle(node).minWidth,
      overflowX: view.getComputedStyle(node).overflowX,
      overflowY: view.getComputedStyle(node).overflowY,
    })
    const textRects = (node: typeof tabpanel) => {
      const range = section.ownerDocument.createRange()
      range.selectNodeContents(node)
      return Array.from(range.getClientRects(), ({ left, right, top, bottom }) => ({ left, right, top, bottom }))
    }
    const gap = section.querySelector('[data-actor-gap]')
    const heading = section.firstElementChild!.querySelector('span')!
    const titlePrefixes = Array.from(section.querySelectorAll('[role="treeitem"] .truncate.font-medium') as ArrayLike<typeof section>, (title) => {
      const text = String(title.textContent ?? "")
      const range = section.ownerDocument.createRange()
      range.setStart(title.firstChild!, 0)
      range.setEnd(title.firstChild!, Array.from(text)[0]?.length ?? 0)
      return { text, rects: Array.from(range.getClientRects(), ({ left, right }) => ({ left, right })) }
    })
    return {
      viewport: { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio },
      workbench: measure(workbench),
      tabpanel: measure(tabpanel), embedded: measure(embedded), scroller: measure(scroller), panel: measure(section),
      refresh: rect(section.querySelector('button')!),
      heading: { text: heading.textContent, rects: textRects(heading) },
      titlePrefixes,
      gap: gap ? { text: gap.textContent, rects: textRects(gap), overflowWrap: view.getComputedStyle(gap).overflowWrap } : null,
    }
  })
  // Keep concrete geometry even on assertion failure, alongside the screenshot/trace.
  await testInfo.attach(`inspector-geometry-${phase}`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" })
  for (const [name, layer] of Object.entries({ workbench: geometry.workbench, tabpanel: geometry.tabpanel })) {
    expect(layer.rect.left, `${phase}: ${name} stays inside viewport left`).toBeGreaterThanOrEqual(-1)
    expect(layer.rect.right, `${phase}: ${name} stays inside viewport right`).toBeLessThanOrEqual(geometry.viewport.width + 1)
  }
  expect(geometry.tabpanel.rect.left, `${phase}: tabpanel stays inside workbench left`).toBeGreaterThanOrEqual(geometry.workbench.rect.left - 1)
  expect(geometry.tabpanel.rect.right, `${phase}: tabpanel stays inside workbench right`).toBeLessThanOrEqual(geometry.workbench.rect.right + 1)
  for (const [name, layer] of Object.entries({ tabpanel: geometry.tabpanel, embedded: geometry.embedded, scroller: geometry.scroller, panel: geometry.panel })) {
    expect(layer.rect.width, `${phase}: ${name} has rendered width`).toBeGreaterThan(0)
    expect(layer.scrollLeft, `${phase}: ${name} must not shift horizontally`).toBe(0)
    expect(layer.scrollWidth, `${phase}: ${name} must not contain horizontal overflow`).toBeLessThanOrEqual(layer.clientWidth + 1)
    expect(layer.rect.left, `${phase}: ${name} left edge`).toBeGreaterThanOrEqual(geometry.tabpanel.rect.left - 1)
    expect(layer.rect.right, `${phase}: ${name} right edge`).toBeLessThanOrEqual(geometry.tabpanel.rect.right + 1)
  }
  // Require visible text inside the intersection of every clipping ancestor,
  // not merely inside an equally shifted parent. Right-end title ellipsis stays intentional.
  const ancestors = [geometry.workbench, geometry.tabpanel, geometry.embedded, geometry.scroller, geometry.panel]
  const visibleLeft = Math.max(0, ...ancestors.map((layer) => layer.rect.left))
  const visibleRight = Math.min(geometry.viewport.width, ...ancestors.map((layer) => layer.rect.right))
  const readable = [geometry.refresh, ...geometry.heading.rects, ...(geometry.gap?.rects ?? []), ...geometry.titlePrefixes.flatMap((title) => title.rects)]
  expect(geometry.heading.rects.length, `${phase}: heading text is rendered`).toBeGreaterThan(0)
  if (geometry.gap) expect(geometry.gap.rects.length, `${phase}: complete gap text is rendered`).toBeGreaterThan(0)
  expect(geometry.titlePrefixes.length, `${phase}: tree titles are rendered`).toBeGreaterThan(0)
  for (const title of geometry.titlePrefixes) expect(title.rects.length, `${phase}: title prefix ${title.text}`).toBeGreaterThan(0)
  for (const box of readable) {
    expect(box.left, `${phase}: text/control left edge`).toBeGreaterThanOrEqual(visibleLeft - 1)
    expect(box.right, `${phase}: text/control right edge`).toBeLessThanOrEqual(visibleRight + 1)
  }
}
