import { createSignal, flush, For } from "solid-js"
import { render } from "@solidjs/web"
import { createChat } from "./createChat"
import { createRunInteractionTimeline, RunInteractions } from "./RunInteractions"

type Chat = ReturnType<typeof createChat>
const scheduleTurn = setTimeout

export async function settleChat(action?: () => unknown) {
  const result = action?.()
  flush()
  await result
  // Drain requests and Solid effects even when the tests control the polling clock.
  await new Promise<void>((resolve) => scheduleTurn(resolve, 0))
  flush()
}

export function renderChatPane(bound?: string | null) {
  const host = document.body.appendChild(document.createElement("div"))
  const [session, setSession] = createSignal(bound ?? null)
  let chat!: Chat
  const dispose = render(() => {
    chat = createChat(bound === undefined ? undefined : session)
    const timeline = createRunInteractionTimeline({ chat, workspace: () => null })
    return <>
      <For each={timeline()} keyed={(attachment) => attachment.key}>
        {(attachment) => <>{attachment().render()}</>}
      </For>
      <RunInteractions chat={chat} />
    </>
  }, host)
  return {
    chat,
    rebind: (id: string | null) => setSession(id),
    dispose: () => {
      dispose()
      host.remove()
    },
  }
}
