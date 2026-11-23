import { PanelLeftOpen, WifiOff } from "@lucide/solid"
import { createEffect, createMemo, createSignal, For, lazy, Loading, Show } from "solid-js"
import { agentClient } from "@services/chat/AgentService"
import { getErrorMessage } from "@services/api/errors"
import { appStore } from "@shared/store/appStore/state"
import { themeStore } from "@shared/store/themeState"
import { copyText } from "@shared/utils/clipboard"
import { openExternalLink } from "@shared/utils/openExternalLink"
import { getUserMessageColors } from "@shared/theme/userMessageColors"
import { markSessionRead } from "@/lib/sessionReadMarkers"
import { setSessionSection } from "@/lib/projectSidebarPreferences"
import { assignSessionToSection } from "@/lib/projectSidebarWrites"
import { sessionHasLiveWork } from "@/lib/sessionBackgroundTasks"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import type { ChatItem } from "@shared/types/chatMessages"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import { createChat } from "../chat/createChat"
import { ChatViewport } from "../chat/ChatViewport"
import { ComposerPanel } from "../chat/ComposerPanel"
import { createStoreSelector } from "../state/createStoreSelector"
import { ThemePreferences } from "../ThemePreferences"
import { Sidebar } from "./Sidebar"
import { createProjectSections } from "./createProjectSections"
import { createUiText } from "./uiText"

const SettingsProviders = lazy(() => import("../settings/SettingsProviders"), { export: "SettingsProviders" })

type SectionIntent = { projectId: string; sectionId?: string | null }
type ConfirmSession = { chat: ChatItem; action: "delete" | "clear" }

function sidebarWidth() {
  try {
    const stored = localStorage.getItem("lotus_next_sidebar_w")
    const width = stored === null ? 288 : Number(stored)
    return Number.isFinite(width) ? Math.max(220, Math.min(420, width)) : 288
  } catch { return 288 }
}

export function SolidApp(props: { ownerAccess: boolean }) {
  const text = createUiText()
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [projectsOpen, setProjectsOpen] = createSignal(false)
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
  const [notice, setNotice] = createSignal<{ text: string; error: boolean } | null>(null)
  const [newSession, setNewSession] = createSignal<SectionIntent | null>(null)
  const [confirm, setConfirm] = createSignal<ConfirmSession | null>(null)
  const [confirmationBusy, setConfirmationBusy] = createSignal(false)
  const [link, setLink] = createSignal<string | null>(null)
  const [image, setImage] = createSignal<string | null>(null)
  const [answer, setAnswer] = createSignal("")
  const [connectionLost, setConnectionLost] = createSignal(false)
  const chat = createChat(undefined, undefined, { pageVisible: () => !settingsOpen() })
  const projects = createStoreSelector(appStore, (state) => state.projects)
  const sections = createProjectSections(projects, appStore.getState)
  const availability = createStoreSelector(appStore, (state) => state.agentAvailability)
  const executions = createStoreSelector(appStore, (state) => state.executionBySession)
  const backgroundBash = createStoreSelector(appStore, (state) => state.backgroundBash)
  const theme = createStoreSelector(themeStore, (state) => state)
  const openError = (error: unknown) => setNotice({ text: getErrorMessage(error), error: true })
  let navigationVersion = 0
  const currentSession = () => chat.currentSessionId
  const displayWorkspace = () => chat.currentChat?.config?.workspacePath
    ?? (newSession() ? projects()[newSession()!.projectId]?.project_path ?? null : null)
  const sessionView = createMemo(() => ({ id: currentSession() }), {
    equals: (previous, next) => previous?.id === next.id,
  })
  const usedSidebarWidth = sidebarWidth()

  createEffect(theme, (state) => {
    const root = document.documentElement
    root.classList.toggle("dark", state.themeMode === "dark")
    const colors = getUserMessageColors(state.themeMode, state.userMessageColorPreset, state.customUserMessageColor)
    root.style.setProperty("--user-message-background", colors.background)
    root.style.setProperty("--user-message-foreground", colors.foreground)
  })
  createEffect(availability, (available) => {
    if (available === false) {
      const timer = window.setTimeout(() => setConnectionLost(true), 3000)
      return () => window.clearTimeout(timer)
    }
    setConnectionLost(false)
  })
  createEffect(() => chat.currentChat, (current) => {
    if (!current) return
    const mark = () => markSessionRead(current)
    mark()
    document.addEventListener("visibilitychange", mark)
    return () => { document.removeEventListener("visibilitychange", mark) }
  })
  createEffect(() => chat.pendingQuestion?.tool_call_id, () => { setAnswer("") })
  createEffect(() => chat.booted, (booted) => {
    if (booted) void appStore.getState().loadProjects().catch(openError)
  })

  const select = async (id: string) => {
    const version = ++navigationVersion
    const previousSession = appStore.getState().currentSessionId
    if (id === DEFAULT_SUPERVISOR_SESSION_ID) {
      await agentClient.ensureDefaultSupervisor()
      if (!await appStore.getState().restoreSession(id)) throw new Error(text("workflow_run_not_found"))
      if (version !== navigationVersion || previousSession !== appStore.getState().currentSessionId) return
    }
    setNewSession(null)
    chat.select(id)
  }
  const newChat = (projectId?: string | null, sectionId?: string | null) => {
    navigationVersion += 1
    setNewSession(projectId ? { projectId, sectionId } : null)
    chat.newChat()
  }
  const sessionCreated = (sessionId: string, intent: SectionIntent | null) => {
    if (!intent) return
    if (newSession() === intent) setNewSession(null)
    if (intent.sectionId !== undefined) {
      void assignSessionToSection(
        appStore.getState, intent.projectId, sessionId, intent.sectionId, projects()[intent.projectId]?.section,
      ).then((ok) => {
        if (!ok) setNotice({ text: text("sidebar_sections_save_failed"), error: true })
      }).catch(openError)
    }
  }
  const confirmAction = async () => {
    const action = confirm()
    if (!action || confirmationBusy()) return
    setConfirmationBusy(true)
    try {
      if (action.action === "delete") await appStore.getState().deleteSession(action.chat.id)
      else await appStore.getState().clearConversation(action.chat.id)
      setConfirm(null)
    } catch (error) {
      openError(error)
    } finally {
      setConfirmationBusy(false)
    }
  }

  return (
    <div class="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <div role="status" aria-live="polite" class="pointer-events-none fixed inset-x-0 top-0 z-[140]">
        <Show when={connectionLost()}>
          <div class="flex items-center justify-center gap-2 bg-destructive px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-xs font-medium text-white">
            <WifiOff class="size-3.5 shrink-0" />
            <span>{text("connection_lost_reconnecting_7ea3f97f")}</span>
          </div>
        </Show>
      </div>
      <div data-slot="chat-shell" inert={settingsOpen()} aria-hidden={settingsOpen() ? "true" : undefined}
        class={`relative h-full min-h-0 overflow-hidden ${settingsOpen() ? "hidden" : "flex"}`}>
        <Sidebar
          open={sidebarOpen()} collapsed={sidebarCollapsed()} width={usedSidebarWidth}
          booted={chat.booted} chats={chat.chats} currentSessionId={currentSession()}
          projects={projects()} sectionPreferences={sections.preferences()}
          isRunning={(entry) => sessionHasLiveWork(entry, executions()[entry.id], backgroundBash())}
          onClose={() => setSidebarOpen(false)} onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
          onSelect={select} onNewChat={newChat}
          onOpenProjectManager={() => setProjectsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onMoveToSection={(projectId, sessionId, sectionId) => {
            void sections.update(projectId, (previous) =>
              setSessionSection(previous, projectId, sessionId, sectionId, projects()[projectId]?.section),
            ).then((ok) => {
              if (!ok) setNotice({ text: text("sidebar_sections_save_failed"), error: true })
            }).catch(openError)
          }}
          onRename={(id, title) => { void appStore.getState().persistSessionTitle(id, title).catch(openError) }}
          onRegenerateTitle={(id) => { void agentClient.regenerateSessionTitle(id).catch(openError) }}
          onTogglePin={(entry) => {
            const state = appStore.getState()
            if (entry.pinned) state.unpinSession(entry.id)
            else state.pinSession(entry.id)
          }}
          onCopySessionId={(id) => {
            void copyText(id).then(() => setNotice({ text: text("session_id_copied_3afb54a6"), error: false })).catch(openError)
          }}
          onClear={(entry) => setConfirm({ chat: entry, action: "clear" })}
          onDelete={(entry) => setConfirm({ chat: entry, action: "delete" })}
          onError={openError}
        />
        <main class="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <header class="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-2">
            <Button variant="ghost" size="icon" class={sidebarCollapsed() ? "" : "md:hidden"}
              aria-label={text("menu_4ce4cafd")} onClick={() => {
                setSidebarOpen(true); setSidebarCollapsed(false)
              }}>
              <PanelLeftOpen class="size-4" />
            </Button>
            <h1 class="min-w-0 flex-1 truncate text-sm font-semibold">
              {chat.currentChat?.title || text("new_session_c57c30bc")}
            </h1>
          </header>
          <Show when={sessionView()} keyed>{(_session) => (
            <ChatViewport chat={chat} theme={theme().themeMode}
              onOpenLink={setLink} onPreviewImage={setImage} />
          )}</Show>
          <Show when={chat.pendingQuestion}>
            {(question) => (
              <section class="mx-auto mb-3 grid w-full max-w-4xl gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
                <p>{question().question}</p>
                <div class="flex flex-wrap gap-2">
                  <For each={question().options} keyed={false}>{(option) => (
                    <Button variant="outline" disabled={chat.questionSubmitting || chat.questionUnavailable}
                      onClick={() => { void chat.answerQuestion(option()) }}>
                      {option()}
                    </Button>
                  )}</For>
                </div>
                <Show when={question().interaction_kind === "clarification" && question().allow_custom}>
                  <form class="flex gap-2" onSubmit={(event) => {
                    event.preventDefault()
                    const value = answer().trim()
                    if (value && !chat.questionUnavailable && !chat.questionSubmitting) void chat.answerQuestion(value)
                  }}>
                    <input class="min-w-0 flex-1 rounded-md border bg-background px-2" aria-label={text("messages_4da199fa")}
                      value={answer()} onInput={(event) => setAnswer(event.currentTarget.value)} />
                    <Button type="submit" disabled={!answer().trim() || chat.questionUnavailable || chat.questionSubmitting}>
                      {text("send_message_00881483")}
                    </Button>
                  </form>
                </Show>
                <Show when={chat.questionError}><p role="alert" class="text-destructive">{chat.questionError}</p></Show>
              </section>
            )}
          </Show>
          <Show when={chat.pendingApproval}>
            {(request) => (
              <section aria-label={text("subagent_approval_request_4321e83b")}
                class="mx-auto mb-3 w-full max-w-4xl rounded-lg border bg-card px-4 py-3 text-sm">
                <p>{request().toolName} {request().permission}</p>
                <p class="break-all text-xs text-muted-foreground">{request().resource}</p>
                <div class="mt-2 flex gap-2">
                  <Button variant="secondary" disabled={chat.approvalSubmitting}
                    onClick={() => { void chat.respondApproval(false) }}>{text("deny_136de7a8")}</Button>
                  <Button disabled={chat.approvalSubmitting}
                    onClick={() => { void chat.respondApproval(true) }}>{text("approve_8cbe697b")}</Button>
                </div>
                <Show when={chat.approvalError}><p role="alert" class="text-destructive">{chat.approvalError}</p></Show>
              </section>
            )}
          </Show>
          <ComposerPanel chat={chat} workspacePath={displayWorkspace()} projectId={newSession()?.projectId ?? null}
            captureSessionCreated={() => {
              const intent = newSession()
              return (id) => sessionCreated(id, intent)
            }} />
        </main>
      </div>
      <Show when={settingsOpen()}>
        <div class="min-h-0 flex-1 overflow-y-auto" data-slot="settings-page">
          <div class="mx-auto grid w-full max-w-4xl gap-4 px-4 py-6">
            <div class="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setSettingsOpen(false)}>{text("close_settings_77b17fc4")}</Button>
              <h1 class="text-lg font-semibold">{text("system_settings_68ea5dd4")}</h1>
            </div>
            <ThemePreferences preference={theme().themePreference} />
            <Show when={props.ownerAccess}>
              <Loading fallback={<p role="status">{text("loading_4927a53b")}</p>}><SettingsProviders /></Loading>
            </Show>
          </div>
        </div>
      </Show>
      <ResponsiveDialog open={projectsOpen()} onOpenChange={setProjectsOpen}>
        <ResponsiveDialogContent class="p-5">
          <ResponsiveDialogTitle>{text("manage_projects_302f96cf")}</ResponsiveDialogTitle>
          <div class="mt-4 grid gap-2">
            <For each={Object.values(projects())} keyed={(project) => project.id}>{(project) => (
              <Button class="justify-start" variant="outline" onClick={() => {
                newChat(project().id); setProjectsOpen(false)
              }}>{project().name}</Button>
            )}</For>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog open={confirm() !== null} onOpenChange={(open) => {
        if (!open && !confirmationBusy()) setConfirm(null)
      }}>
        <ResponsiveDialogContent class="p-5" showCloseButton={false} dismissable={!confirmationBusy()}>
          <ResponsiveDialogTitle>{text(confirm()?.action === "clear" ? "conversation_clear_title" : "delete_session_d51250d1")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="mt-2">
            {confirm()?.action === "clear"
              ? text("conversation_clear_impact")
              : text("delete_session_description", { title: confirm()?.chat.title ?? "" })}
          </ResponsiveDialogDescription>
          <div class="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={confirmationBusy()} onClick={() => setConfirm(null)}>
              {text("cancel_2cd0f3be")}
            </Button>
            <Button variant="destructive" disabled={confirmationBusy()} onClick={() => { void confirmAction() }}>
              {text(confirm()?.action === "clear" ? "conversation_clear_action" : "delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog open={link() !== null} onOpenChange={(open) => { if (!open) setLink(null) }}>
        <ResponsiveDialogContent class="p-5">
          <ResponsiveDialogTitle>{text("open_external_link_fd407c70")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="my-3 break-all">{link()}</ResponsiveDialogDescription>
          <Button onClick={() => {
            const url = link()
            if (url) void openExternalLink(url).then(() => setLink(null)).catch(openError)
          }}>{text("open_in_default_browser_a489338a")}</Button>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog open={image() !== null} onOpenChange={(open) => { if (!open) setImage(null) }}>
        <ResponsiveDialogContent class="p-5">
          <ResponsiveDialogTitle class="sr-only">{text("close_preview_1eb05d31")}</ResponsiveDialogTitle>
          <img class="mx-auto max-h-[75dvh] object-contain" src={image() ?? undefined} alt="" />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <Show when={notice()}>
        {(value) => (
          <div role={value().error ? "alert" : "status"} class="fixed inset-x-0 bottom-28 z-[150] flex justify-center px-4">
            <button type="button" onClick={() => setNotice(null)}
              class="rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl">{value().text}</button>
          </div>
        )}
      </Show>
    </div>
  )
}
