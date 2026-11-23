import { createEffect, type Accessor } from "solid-js"
import { observeSessionTaskList } from "@services/chat/accountFeed"
import type { TaskItem } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import { createStoreSelector } from "../../state/createStoreSelector"

const EMPTY_TASKS: readonly TaskItem[] = []

export function selectSessionTasks(sessionId: Accessor<string | null>) {
  return createStoreSelector(appStore, (state) => {
    const id = sessionId()
    return id ? state.taskLists[id]?.items ?? EMPTY_TASKS : EMPTY_TASKS
  })
}

/** Keep the visible root's task projection live while its workbench is closed. */
export function createSessionTaskDag(
  sessionId: Accessor<string | null>,
  running: Accessor<boolean>,
) {
  createEffect(sessionId, (id) => id ? observeSessionTaskList(id) : undefined)
  createEffect(
    () => ({ id: sessionId(), running: running() }),
    ({ id, running }, previous) => {
      if (id && (previous?.id !== id || (previous.running && !running))) {
        void appStore.getState().loadTaskList(id).catch(() => undefined)
      }
    },
  )
  return selectSessionTasks(sessionId)
}
