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
