import { apiClient } from "@services/api"
import type {
  BrowserDialogResponse,
  BrowserDomSnapshot,
  BrowserFrame,
  BrowserHistoryDirection,
  BrowserInput,
  BrowserScreenshot,
  BrowserState,
  BrowserViewport,
} from "./types"

const sessionPath = (sessionId: string): string =>
  `browser/sessions/${encodeURIComponent(sessionId)}`

const nonNegativeIntegerHeader = (response: Response, name: string): number => {
  const raw = response.headers.get(name)
  const value = raw !== null && /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid browser frame ${name} header`)
  }
  return value
}

const tabIdHeader = (response: Response): string | undefined => {
  const id = response.headers.get("X-Tab-Id")
  if (id === null) return undefined
  if (!id.trim()) throw new Error("Invalid browser X-Tab-Id header")
  return id
}

export class BrowserService {
  open(sessionId: string, signal?: AbortSignal): Promise<BrowserState> {
    return apiClient.put<BrowserState>(sessionPath(sessionId), {}, { signal })
  }

  get(sessionId: string, signal?: AbortSignal): Promise<BrowserState> {
    return apiClient.get<BrowserState>(sessionPath(sessionId), { signal })
  }

  close(sessionId: string): Promise<void> {
    return apiClient.delete<void>(sessionPath(sessionId))
  }

  navigate(sessionId: string, url: string, expectedEpoch: number): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/navigate`, {
      url,
      expected_epoch: expectedEpoch,
    })
  }

  history(
    sessionId: string,
    direction: BrowserHistoryDirection,
    expectedEpoch: number,
  ): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/history`, {
      direction,
      expected_epoch: expectedEpoch,
    })
  }

  viewport(
    sessionId: string,
    viewport: BrowserViewport,
    expectedEpoch: number,
  ): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/viewport`, {
      ...viewport,
      expected_epoch: expectedEpoch,
    })
  }

  input(sessionId: string, input: BrowserInput, expectedEpoch: number): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/input`, {
      ...input,
      expected_epoch: expectedEpoch,
    })
  }

  createTab(sessionId: string, expectedEpoch: number): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/tabs`, {
      expected_epoch: expectedEpoch,
    })
  }

  activateTab(sessionId: string, tabId: string, expectedEpoch: number): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/tabs/activate`, {
      tab_id: tabId,
      expected_epoch: expectedEpoch,
    })
  }

  closeTab(sessionId: string, tabId: string, expectedEpoch: number): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/tabs/close`, {
      tab_id: tabId,
      expected_epoch: expectedEpoch,
    })
  }

  respondDialog(sessionId: string, response: BrowserDialogResponse): Promise<BrowserState> {
    return apiClient.post<BrowserState>(`${sessionPath(sessionId)}/dialog`, {
      dialog_id: response.dialog_id,
      expected_epoch: response.expected_epoch,
      accept: response.accept,
      ...(response.text !== undefined ? { text: response.text } : {}),
    })
  }

  dom(sessionId: string, signal?: AbortSignal): Promise<BrowserDomSnapshot> {
    return apiClient.get<BrowserDomSnapshot>(`${sessionPath(sessionId)}/dom`, { signal })
  }

  async frame(
    sessionId: string,
    after: number,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<BrowserFrame | null> {
    const params = new URLSearchParams({ after: String(after), wait_ms: String(waitMs) })
    const response = await apiClient.fetchRaw(`${sessionPath(sessionId)}/frame?${params}`, {
      cache: "no-store",
      signal,
    })
    if (response.status === 204) return null
    try {
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/jpeg")) {
        throw new Error("Browser frame is not a JPEG image")
      }
      const frame_seq = nonNegativeIntegerHeader(response, "X-Frame-Seq")
      const page_epoch = nonNegativeIntegerHeader(response, "X-Page-Epoch")
      const active_tab_id = tabIdHeader(response)
      const width = nonNegativeIntegerHeader(response, "X-Viewport-Width")
      const height = nonNegativeIntegerHeader(response, "X-Viewport-Height")
      if (width === 0 || height === 0) {
        throw new Error("Browser frame has an empty viewport")
      }
      return {
        blob: await response.blob(),
        frame_seq,
        page_epoch,
        active_tab_id,
        viewport: { width, height },
      }
    } catch (error) {
      await response.body?.cancel().catch(() => undefined)
      throw error
    }
  }

  async screenshot(sessionId: string, signal?: AbortSignal): Promise<BrowserScreenshot> {
    const response = await apiClient.fetchRaw(`${sessionPath(sessionId)}/screenshot`, {
      cache: "no-store",
      signal,
    })
    try {
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/jpeg")) {
        throw new Error("Browser screenshot is not a JPEG image")
      }
      const page_epoch = nonNegativeIntegerHeader(response, "X-Page-Epoch")
      const active_tab_id = tabIdHeader(response)
      return { blob: await response.blob(), page_epoch, active_tab_id }
    } catch (error) {
      await response.body?.cancel().catch(() => undefined)
      throw error
    }
  }
}

export const browserService = new BrowserService()
