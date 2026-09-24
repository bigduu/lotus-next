export interface BrowserViewport {
  width: number
  height: number
}

/** Bamboo owns every tab in this agent session. */
export interface BrowserTabSummary {
  tab_id: string
  url: string
  title: string
  active: boolean
}

export interface BrowserPendingDialog {
  dialog_id: string
  tab_id: string
  page_epoch: number
  url: string
  type: "alert" | "confirm" | "prompt"
  message: string
  message_truncated: boolean
  default_value: string
  default_value_truncated: boolean
  expires_at_ms: number
  status: "pending" | "expired"
}

export interface BrowserState {
  page_epoch: number
  frame_seq: number
  url: string
  title: string
  viewport: BrowserViewport
  can_go_back: boolean
  can_go_forward: boolean
  loading?: boolean
  /** Absent when connected to a Bamboo version without tab support. */
  active_tab_id?: string
  tabs?: BrowserTabSummary[]
  /** Present on Bamboo versions with JavaScript dialog support. */
  pending_dialog?: BrowserPendingDialog | null
}

export interface BrowserDialogResponse {
  dialog_id: string
  expected_epoch: number
  accept: boolean
  text?: string
}

export type BrowserHistoryDirection = "back" | "forward" | "reload"

export type BrowserInput =
  | {
      kind: "click"
      x: number
      y: number
      button?: "left" | "right" | "middle"
    }
  | { kind: "scroll"; x: number; y: number; delta_x: number; delta_y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }

export interface BrowserDomSnapshot {
  page_epoch: number
  active_tab_id?: string
  url: string
  title: string
  snapshot: string
}

export interface BrowserFrame {
  blob: Blob
  frame_seq: number
  page_epoch: number
  active_tab_id?: string
  viewport: BrowserViewport
}

export interface BrowserScreenshot {
  blob: Blob
  page_epoch: number
  active_tab_id?: string
}
