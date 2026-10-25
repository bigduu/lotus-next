import { expect, test } from "@playwright/test"
import { createHash } from "node:crypto"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const at = "2026-10-25T04:51:29.725Z"
const timeoutError = "Stream timed out: phase=transport_idle, deadline_ms=120000, provider=a2a3cebf-8abc-45cb-8407-66c90fd9a978, model=gpt-6-astra, last_transport_ms_ago=120002, last_semantic_ms_ago=120002ms, semantic_output_started=true, retry_safe=false. Diagnostic ID: 9ab6cd70-bc43-4fed-9f10-50c2873fa287."

test("a saved stream timeout exports current progress and withdraws missing refreshed details", async ({ page }, info) => {
  test.skip(info.project.name === "tablet-chromium", "desktop and phone cover the diagnostic dialog")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const history = [{ id:"partial-answer", role:"assistant", content:"Partial answer retained before timeout.", created_at:at }]
  const observation = await installArtifactRuntime(page, standaloneScenario, history)
  let diagnostic: unknown = { schema_version:1,kind:"stream_timeout",diagnostic_id:"9ab6cd70-bc43-4fed-9f10-50c2873fa287",
    error_id:"9ab6cd70-bc43-4fed-9f10-50c2873fa287",observed_at:at,provider:"a2a3cebf-8abc-45cb-8407-66c90fd9a978",model:"gpt-6-astra",
    session_hash:createHash("sha256").update("bamboo-provider-operational-log-v1\0" + sessionId).digest("hex").slice(0,16),
    run_id:"b65d9caa-1250-4a89-8d77-2c77b06c634b",phase:"transport_idle",deadline_ms:120000,
    last_transport_ms_ago:120002,last_semantic_ms_ago:120002,semantic_output_started:true,retry_safe:false,
    last_http_status:null,retry_delay_ms:null }
  const session = {
    id:sessionId, kind:"root", root_session_id:sessionId, root_orchestration_only:false, thinking_mode:"standard",
    root_mode_transition_epoch:0, root_mode_birth_token:"a".repeat(64), title:"Stream timeout fixture", title_version:1,
    pinned:false, parent_session_id:null, spawn_depth:0, model:"fixture-model",
    model_ref:{ provider:"fixture-provider", model:"fixture-model" }, reasoning_effort:"max",
    created_at:at, updated_at:at, last_activity_at:at, message_count:1, has_attachments:false,
    is_running:false, last_run_status:"error", last_run_error:timeoutError,
    has_pending_question:false, running_child_count:0, permission_mode:"default", bypass_permissions:false,
  }
  const writes: string[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() !== "GET" && (url.pathname === "/api/v1/chat"
      || /^\/api\/v1\/(execute|sessions)\//.test(url.pathname))) writes.push(`${request.method()} ${url.pathname}`)
    if (url.pathname === "/api/v1/sessions") {
      const sessions = url.searchParams.get("kind") === "child" ? [] : [session]
      return route.fulfill({ json:{ sessions,total:sessions.length,limit:200,offset:0 } })
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}`) {
      return route.fulfill({ json:{ session:{ ...session,last_run_diagnostic:diagnostic } },headers:{ ETag:'"1"' } })
    }
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText(session.title)
  await expect(page.locator(".assistant-streamdown")).toContainText(history[0]!.content)
  await page.getByRole("button", { name:"查看诊断",exact:true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name:"读取服务诊断",exact:true }).click()
  await expect(dialog).toContainText("已从当前会话保存的错误中读取。")
  await expect(dialog.locator("dl")).toContainText("模型响应流没有活动")
  await expect(dialog.locator("dl")).toContainText("120000 ms")
  await expect(dialog.locator("dl")).toContainText("此请求不适合自动重放")
  const preview = dialog.locator('pre[aria-label="诊断 JSON 预览"]')
  const report = JSON.parse(await preview.textContent() ?? "null")
  expect(report.diagnostic).toMatchObject({ kind:"stream_timeout",source:"canonical_read",canonical_status:"confirmed",
    model:"gpt-6-astra",deadline_ms:120000,last_transport_ms_ago:120002,last_semantic_ms_ago:120002,
    semantic_output_started:true,retry_safe:false,attempt:null,request_id:null })
  await info.attach("stream-timeout-diagnostics", { body:await page.screenshot({ fullPage:true }),contentType:"image/png" })
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name:"下载诊断 JSON",exact:true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe("bamboo-run-diagnostics.json")
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(report)
  diagnostic = null
  await dialog.getByRole("button", { name:"读取服务诊断",exact:true }).click()
  await expect(preview).toContainText('"canonical_status": "not_provided"')
  expect(JSON.parse(await preview.textContent() ?? "null").diagnostic).toMatchObject({ kind:null,deadline_ms:null,
    last_transport_ms_ago:null,last_semantic_ms_ago:null,semantic_output_started:null,retry_safe:null })
  await expect(dialog.locator("dl")).not.toContainText("120000 ms")
  expect(writes).toEqual([])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
