import type { Page } from "@playwright/test"

/** Record native resize delivery without swallowing its browser errors. */
export async function installResizeDiagnostics(page: Page) {
  await page.addInitScript(() => {
    type Entry = {
      target: { tagName: string; attributes: Iterable<{ name: string; value: string }> }
      contentRect: { width: number; height: number }
    }
    type Callback = (entries: Entry[], observer: unknown) => void
    const browser = globalThis as unknown as {
      ResizeObserver: new (callback: Callback) => object
      addEventListener(name: string, callback: (event: { message: string }) => void): void
    }
    const diagnostics = { errors: [] as unknown[], deliveries: [] as unknown[] }
    Object.assign(globalThis, { __resizeDiagnostics: diagnostics })
    const Original = browser.ResizeObserver
    browser.ResizeObserver = class extends Original {
      constructor(callback: Callback) {
        const stack = new Error("ResizeObserver registered").stack
        super((entries, observer) => {
          const delivery = {
            stack,
            callback: callback.name,
            targets: entries.map(({ target, contentRect }) => ({
              tag: target.tagName,
              attributes: [...target.attributes].map(({ name, value }) => [name, value]),
              before: { width: contentRect.width, height: contentRect.height },
            })),
          }
          diagnostics.deliveries.push(delivery)
          if (diagnostics.deliveries.length > 80) diagnostics.deliveries.shift()
          callback(entries, observer)
        })
      }
    }
    browser.addEventListener("error", (event) => {
      diagnostics.errors.push({ message: event.message, deliveries: [...diagnostics.deliveries] })
    })
  })
}
