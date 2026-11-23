import { Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import { ModelEffortPicker } from "./ModelEffortPicker"
import type { createComposerModelControls } from "./createComposerModelControls"

export function ComposerModelControls(props: { controls: ReturnType<typeof createComposerModelControls> }) {
  const text = createUiText()
  const root = () => props.controls.root
  const thinking = () => props.controls.thinking
  const error = () => thinking().error ?? props.controls.modelError
  const status = () => {
    const state = root()
    if (state.unsafe && props.controls.busy && !error()) return text("waiting_for_server_confirmation_71efb37a")
    if (state.unsafe) return text(state.recovering ? "recovering_permission_result_7a4a9813" : "permission_result_unknown_37e663a7")
    if (state.loading) return text("reading_server_state_14b7f241")
    if (props.controls.busy) return text("waiting_for_server_confirmation_71efb37a")
    if (thinking().requestValue !== undefined) {
      return text(thinking().requestValue ? "use_ultra_orchestration_for_the_next_session_7f755f23" : "use_standard_mode_for_the_next_session_b08ea9c5")
    }
    if (thinking().selected === null) return text("state_unavailable_a9dcef67")
    return text(state.confirmed ? "server_confirmed_ultra_orchestration_25a54375" : "server_confirmed_standard_mode_fb0ea60d")
  }
  return <>
    <div class={error() ? "flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs" : "sr-only"}
      aria-busy={root().loading || props.controls.busy || root().recovering ? "true" : "false"}>
      <Show when={!root().child}>
        <span role="status" aria-live="polite" class="sr-only">{status()}</span>
      </Show>
      <Show when={error()}>
        <span role="alert" class="basis-full text-destructive">
          {error()}
          <Show when={root().recoverable && !root().child}>
            <button type="button" class="ml-1 underline" disabled={root().recovering || props.controls.busy}
              onClick={() => { void thinking().retry() }}>
              {text("recover_mode_change_ca1cc75a")}
            </button>
          </Show>
          <Show when={thinking().error && !root().recoverable && !root().child && !root().unsafe}>
            <button type="button" class="ml-1 underline" disabled={props.controls.busy}
              onClick={() => { void thinking().retry() }}>
              {text("reload_state_df7392cc")}
            </button>
          </Show>
        </span>
      </Show>
    </div>
    <ModelEffortPicker modelGroups={props.controls.modelGroups} model={props.controls.model}
      modelProvider={props.controls.modelProvider} onModelChange={(model) => { void props.controls.chooseModel(model) }}
      modelDisabled={props.controls.modelDisabled} value={thinking().ordinaryValue}
      allowUltra={root().isRoot} thinkingMode={thinking().thinkingMode}
      disabled={thinking().disabled} onChange={(selection) => { void thinking().choose(selection) }} />
  </>
}
