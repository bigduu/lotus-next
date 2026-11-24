import { createContext, Show, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"

const ChangeOpen = createContext<(open: boolean) => void>()

// JSDOM cannot share the bundled Kobalte Dialog owner with the installed Solid
// JSX runtime. The built browser suites exercise the real dialog and focus.
export function ResponsiveDialog(props: { open?: boolean; onOpenChange: (open: boolean) => void; children: JSX.Element }) {
  return <Show when={props.open}><ChangeOpen value={props.onOpenChange}>{props.children}</ChangeOpen></Show>
}

export function ResponsiveDialogContent(props: { dismissable?: boolean; children: JSX.Element }) {
  const changeOpen = useContext(ChangeOpen)
  return <div role="dialog" onKeyDown={(event) => {
    if (event.key === "Escape" && props.dismissable !== false) changeOpen(false)
  }}>{props.children}</div>
}

export function ResponsiveDialogTitle(props: { children: JSX.Element }) {
  return <h2>{props.children}</h2>
}

export function ResponsiveDialogDescription(props: { children: JSX.Element }) {
  return <p>{props.children}</p>
}
