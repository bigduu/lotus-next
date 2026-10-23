/** Radix receives Escape at document capture, before the Command key handler. */
export function isCommandComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229 ||
    (event.target instanceof Element && Boolean(event.target.closest('[data-command-composing="true"]')))
}
