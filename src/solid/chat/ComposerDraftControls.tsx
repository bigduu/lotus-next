import { BookText, Check, ChevronDown, FolderClosed } from "@lucide/solid"
import { createMemo, For, Show } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { composerControlClassName } from "@/lib/composer/composerStyles"
import { createUiText } from "../shell/uiText"
import { createStoreSelector } from "../state/createStoreSelector"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu"

export function NewChatProjectControl(props: { projectId: string | null; onSelect: (id: string | null) => void }) {
  const text = createUiText()
  const projects = createStoreSelector(appStore, (state) => state.projects)
  const available = createStoreSelector(appStore, (state) => state.projectsAvailable)
  const selectables = createMemo(() => Object.values(projects())
    .filter((project) => project.status === "active" && project.project_path_status === "configured")
    .sort((first, second) => second.updated_at.localeCompare(first.updated_at)))
  const selected = () => props.projectId ? projects()[props.projectId] : undefined

  return <Show when={available() !== false}>
    <DropdownMenu placement="top-start">
      <DropdownMenuTrigger type="button" class={composerControlClassName}
        title={selected() ? text("project_690aa0ce", { v0: selected()?.name }) : text("select_project_682279bf")}>
        <FolderClosed class="size-4 shrink-0" />
        <span class="truncate">{selected()?.name ?? text("select_project_682279bf")}</span>
        <ChevronDown class="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => props.onSelect(null)}>
          <Show when={!selected()} fallback={<span class="size-3.5" />}><Check class="size-3.5" /></Show>
          {text("no_project_4fdaa950")}
        </DropdownMenuItem>
        <For each={selectables()} keyed={(project) => project.id}>{(project) =>
          <DropdownMenuItem onSelect={() => props.onSelect(project().id)}>
            <Show when={project().id === selected()?.id} fallback={<span class="size-3.5" />}><Check class="size-3.5" /></Show>
            <span class="truncate">{project().name}</span>
          </DropdownMenuItem>
        }</For>
      </DropdownMenuContent>
    </DropdownMenu>
  </Show>
}

export function NewChatPromptControl() {
  const text = createUiText()
  const prompts = createStoreSelector(appStore, (state) => state.systemPrompts)
  const selectedId = createStoreSelector(appStore, (state) => state.lastSelectedPromptId)
  const active = createMemo(() => prompts().find((prompt) => prompt.id === selectedId())
    ?? prompts().find((prompt) => prompt.isDefault) ?? prompts()[0])

  return <Show when={active()}>{(prompt) =>
    <DropdownMenu placement="top-start">
      <DropdownMenuTrigger type="button" class={composerControlClassName}
        title={text("system_prompt_b9068145", { v0: prompt().name })}>
        <BookText class="size-4 shrink-0" />
        <span class="truncate">{prompt().name}</span>
        <ChevronDown class="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <For each={prompts()} keyed={(entry) => entry.id}>{(entry) =>
          <DropdownMenuItem onSelect={() => appStore.getState().setLastSelectedPromptId(entry().id)}>
            <Show when={entry().id === prompt().id} fallback={<span class="size-3.5" />}><Check class="size-3.5" /></Show>
            <span class="truncate">{entry().name}</span>
          </DropdownMenuItem>
        }</For>
      </DropdownMenuContent>
    </DropdownMenu>
  }</Show>
}
