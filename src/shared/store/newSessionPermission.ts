/**
 * Per-session permission-mode selection for the NEXT new session.
 *
 * The initial value is the server's durable permission-policy default
 * (Settings → Permissions → 新会话默认权限). The user can override it per
 * new-chat from the composer picker; the override is local-only and
 * consumed by the first send that creates a session.
 */

import { create } from "zustand"
import { parseSessionPermissionMode, type SessionPermissionMode } from "@services/chat/AgentService"
import { settingsService } from "@services/config/SettingsService"

interface NewSessionPermissionState {
  /** The mode the next NEW session will be created with. */
  mode: SessionPermissionMode
  /** True until the durable policy default has been loaded (or failed). */
  loaded: boolean
  /** Local override picked from the composer picker (not persisted). */
  setMode: (mode: SessionPermissionMode) => void
  /** Re-read the durable policy default; a local override is replaced. */
  refresh: () => Promise<void>
}

export const useNewSessionPermission = create<NewSessionPermissionState>((set, get) => ({
  mode: "default",
  loaded: false,
  setMode: (mode) => set({ mode }),
  refresh: async () => {
    try {
      const response = await settingsService.getDefaultSessionPermissionMode()
      const parsed = parseSessionPermissionMode(response.mode)
      if (parsed) set({ mode: parsed, loaded: true })
    } catch {
      // Unavailable policy leaves the current selection (default) in place.
      if (!get().loaded) set({ loaded: true })
    }
  },
}))
