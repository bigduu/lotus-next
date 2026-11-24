import { createSignal, flush, Show } from "solid-js"
import { render } from "@solidjs/web"
import { ProjectWorkBoard, type ProjectWorkBoardProps } from "./ProjectWorkBoard"

const schedule = setTimeout

export async function settle(action: () => unknown = () => undefined) {
  await action()
  await new Promise<void>((resolve) => schedule(resolve, 0))
  flush()
}

export function mountProjectWorkBoard() {
  const host = document.body.appendChild(document.createElement("div"))
  const [props, setProps] = createSignal<ProjectWorkBoardProps>()
  const dispose = render(() => <Show when={props()?.project.id} keyed>
    {(_id) => <ProjectWorkBoard {...props()!} />}
  </Show>, host)
  return {
    update: (next: ProjectWorkBoardProps) => settle(() => setProps(next)),
    dispose() { dispose(); host.remove() },
  }
}
