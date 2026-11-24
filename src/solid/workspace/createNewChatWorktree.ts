import { createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { NewChatWorktreePreparation, type WorktreePreparationFailure } from "@services/workspace/newChatWorktreePreparation"
import { createStoreSelector } from "../state/createStoreSelector"
import { createUiText } from "../shell/uiText"

const errorKeys = {
  invalid: "chat_worktree_invalid_config",
  "missing-root": "chat_worktree_missing_root",
  "no-source": "chat_worktree_no_git",
  "source-unavailable": "chat_worktree_source_unavailable",
  "ambiguous-source": "chat_worktree_ambiguous_source",
  uncertain: "chat_worktree_uncertain",
  "context-changed": "chat_worktree_context_changed",
  failed: "chat_worktree_prepare_failed",
} as const satisfies Record<WorktreePreparationFailure, string>

export function createNewChatWorktree(input: {
  sessionId: Accessor<string | null>
  projectId: Accessor<string | null>
  workspacePath: Accessor<string | null>
  existingPath: Accessor<string | null>
  draftEpoch: Accessor<number>
  navigationVersion: () => number
}) {
  const text = createUiText()
  const projectDefault = createStoreSelector(appStore, (state) => {
    const project = input.projectId()
    return Boolean(project && state.projects[project]?.new_chat_worktree)
  })
  const [revision, setRevision] = createSignal(0)
  let mounted = true
  let ledgers = new Map<string, NewChatWorktreePreparation>()
  let draftEpoch = input.draftEpoch()
  onSettled(() => () => { mounted = false })

  const scope = createMemo(() => ({
    sessionId: input.sessionId(),
    projectId: input.projectId(),
    workspace: input.workspacePath(),
    existingPath: input.existingPath(),
    epoch: input.draftEpoch(),
  }), {
    equals: (before, after) => before?.sessionId === after.sessionId && before.projectId === after.projectId &&
      before.workspace === after.workspace && before.existingPath === after.existingPath && before.epoch === after.epoch,
  })
  const preparation = createMemo(() => {
    const { projectId, workspace, existingPath, epoch } = scope()
    if (epoch !== draftEpoch) {
      draftEpoch = epoch
      ledgers = new Map()
    }
    const key = JSON.stringify([projectId, workspace, existingPath])
    let ledger = ledgers.get(key)
    if (!ledger) {
      ledger = new NewChatWorktreePreparation(projectId, () => {
        if (mounted) setRevision((value) => value + 1)
      })
      ledgers.set(key, ledger)
    }
    return ledger
  })
  const ledger = () => { revision(); return preparation() }
  const automatic = () => !input.sessionId() && !input.existingPath() && projectDefault() && ledger().useProjectDefault

  const capture = () => {
    const origin = scope()
    const version = input.navigationVersion()
    const current = preparation()
    const projectDefault = automatic()
    const isCurrent = () => mounted && scope() === origin && input.navigationVersion() === version &&
      appStore.getState().currentSessionId === origin.sessionId
    return {
      isCurrent,
      viewerIsCurrent: () => mounted && input.navigationVersion() === version,
      prepare: !origin.sessionId && (current.selection !== null || projectDefault)
        ? () => current.prepare(isCurrent, projectDefault) : null,
    }
  }
  return {
    capture,
    get automatic() { return automatic() },
    get selection() { return ledger().selection },
    get locked() { return Boolean(input.existingPath()) || ledger().locked },
    get busy() { return ledger().busy },
    get preparedPath() { return ledger().path },
    get error() {
      const failure = ledger().error
      return failure ? text(errorKeys[failure.kind]) : null
    },
    select: (value: NewChatWorktreePreparation["selection"]) => preparation().select(value),
  }
}
