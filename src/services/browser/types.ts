export interface BrowserViewport {
  width: number
  height: number
}

/** One Bamboo-owned page belongs to one agent session. */
export interface BrowserState {
  page_epoch: number
  frame_seq: number
  url: string
  title: string
  viewport: BrowserViewport
  can_go_back: boolean
  can_go_forward: boolean
  loading?: boolean
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
  url: string
  title: string
  snapshot: string
}

export interface BrowserFrame {
  blob: Blob
  frame_seq: number
  page_epoch: number
  viewport: BrowserViewport
}
