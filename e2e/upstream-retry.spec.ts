import { expect, test, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// Controlled API/WS contract only. This does not run provider retries or timers.
const sid="all-surface-session", at="2026-10-27T00:00:00Z"
async function fixture(page:Page, support:boolean) {
  await page.addInitScript((id)=>{localStorage.setItem("bodhi_onboarded_v1","1");localStorage.setItem("lotus_ui_locale_v1","en-US");localStorage.setItem("lotus_next_last_session",id)},sid)
  const runtime=await installArtifactRuntime(page,standaloneScenario,[],{bootstrapRequestState:"local_bypass"})
  let supported=support, reads=0, activeRun:string|null=null
  const cancelledRuns:string[]=[]
  const writes:{path:string;body:unknown;run:string|undefined}[]=[]
  const session={id:sid,title:"Synthetic connection retry",kind:"root",title_version:1,root_session_id:sid,parent_session_id:null,
    spawn_depth:0,pinned:false,model:"fixture-model",model_ref:{provider:"fixture-provider",model:"fixture-model"},
    created_at:at,updated_at:at,last_activity_at:at,message_count:2,workspace_path:"/workspace/synthetic",permission_mode:"default",
    bypass_permissions:false,is_running:false,last_run_status:"error",last_run_error:"Initial connection timed out (synthetic)",subagent_count:0,
    root_orchestration_only:false,thinking_mode:"standard",root_mode_transition_epoch:0,root_mode_birth_token:"a".repeat(64)}
  await page.route("**/api/v1/**",async(route)=>{
    const req=route.request(),path=new URL(req.url()).pathname
    if(req.method()!=="GET") writes.push({path,body:req.postData()?req.postDataJSON():null,run:req.headers()["bamboo-run-id"]})
    if(path==="/api/v1/execute/defaults") {reads++;return route.fulfill({json:supported?{upstream_retry:{supported_modes:["bounded","until_cancelled"],default_mode:"bounded",max_attempts:6,total_budget_ms:120000,attempt_timeout_ms:20000}}:{}})}
    if(path==="/api/v1/sessions")return route.fulfill({json:{sessions:new URL(req.url()).searchParams.get("kind")==="child"?[]:[session],total:1,limit:200,offset:0}})
    if(path===`/api/v1/sessions/${sid}`)return route.fulfill({json:{session:{...session,execution_compatibility:{session_version:2,current_session_version:2,status:"compatible",history_readable:true,execution_allowed:true,conflicts:[]}}},headers:{ETag:'"1"'}})
    if(path===`/api/v1/history/${sid}`)return route.fulfill({json:{session_id:sid,messages:[
      {id:"original-user",role:"user",content:"One saved instruction",created_at:at},
      {id:"original-assistant",role:"assistant",content:"Earlier completed reply",created_at:at}]}})
    if(path===`/api/v1/actors/${sid}/snapshot`)return route.fulfill({json:actorSnapshotFixture(sid,0)})
    if(path===`/api/v1/task/${sid}`)return route.fulfill({json:{session_id:sid,items:[]}})
    if(path===`/api/v1/respond/${sid}/pending`)return route.fulfill({json:{has_pending_question:false}})
    if(path===`/api/v1/execute/${sid}`&&req.method()==="POST") {
      activeRun="synthetic-original-run";session.is_running=true
      return route.fulfill({json:{session_id:sid,status:"started",run_id:activeRun,events_url:`/api/v1/events/${sid}`}})
    }
    if(path===`/api/v1/stop/${sid}`&&req.method()==="POST") {
      if(req.headers()["bamboo-run-id"]!==activeRun)return route.fulfill({status:409,json:{error:"Stale run identity"}})
      cancelledRuns.push(activeRun!);session.last_run_status="cancelled";session.is_running=false
      return route.fulfill({json:{success:true,session_id:sid,run_id:activeRun}})
    }
    if(req.method()!=="GET")return route.fulfill({status:409,json:{error:"Unexpected write rejected by fixture"}})
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByText("Earlier completed reply",{exact:true})).toBeVisible()
  await expect(page.getByRole("button",{name:"Retry generation",exact:true})).toBeVisible()
  return {runtime,writes,cancelledRuns,get reads(){return reads},withdraw(){supported=false},replaceRun(id:string){activeRun=id}}
}
for(const width of [1440,390])test(`explicit continuous retry resumes once and Stops the exact execution at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900})
  const f=await fixture(page,true),action=page.getByRole("button",{name:"Retry connection until stopped",exact:true})
  await expect(action).toBeEnabled();expect(f.writes).toEqual([])
  await action.click()
  await expect(page.getByText("Continuous connection retries are enabled for this run.",{exact:false})).toBeVisible()
  await expect.poll(()=>f.writes.length).toBe(1)
  expect(f.writes[0]).toMatchObject({path:`/api/v1/execute/${sid}`,body:{upstream_retry:{mode:"until_cancelled"}}})
  expect(f.reads).toBeGreaterThanOrEqual(2)
  await expect(page.getByText("Earlier completed reply",{exact:true})).toBeVisible()
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth",width)
  await page.screenshot({path:info.outputPath(`continuous-enabled-${width}.png`),animations:"disabled"})
  await page.getByRole("button",{name:"Stop generation",exact:true}).click()
  await expect.poll(()=>f.writes.length).toBe(2)
  expect(f.writes[1]).toEqual({path:`/api/v1/stop/${sid}`,body:null,run:"synthetic-original-run"})
  await expect(page.getByText("Stop requested for this execution.",{exact:false})).toBeVisible()
  expect(f.runtime.clientFrames.filter((x)=>!!x&&typeof x==="object"&&"type" in x&&x.type==="stop")).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
  await info.attach("synthetic-wire",{body:JSON.stringify({writes:f.writes,reads:f.reads}),contentType:"application/json"})
})
for(const successor of [false,true])test(`reload retains exact Stop identity when a successor ${successor?"has":"has not"} started`,async({page})=>{
  const f=await fixture(page,true),action=page.getByRole("button",{name:"Retry connection until stopped",exact:true})
  await action.click()
  await expect(page.getByText("Continuous connection retries are enabled for this run.",{exact:false})).toBeVisible()
  await expect.poll(()=>f.writes.length).toBe(1)
  if(successor)f.replaceRun("synthetic-successor-run")
  await page.reload()
  await expect(page.getByText("Earlier completed reply",{exact:true})).toBeVisible()
  await page.getByRole("button",{name:"Stop generation",exact:true}).click()
  await expect.poll(()=>f.writes.filter((entry)=>entry.path===`/api/v1/stop/${sid}`).length).toBe(1)
  expect(f.writes.at(-1)).toEqual({path:`/api/v1/stop/${sid}`,body:null,run:"synthetic-original-run"})
  expect(f.cancelledRuns).toEqual(successor?[]:["synthetic-original-run"])
  expect(f.runtime.clientFrames.filter((x)=>!!x&&typeof x==="object"&&"type" in x&&x.type==="stop")).toEqual([])
  if(successor)await expect(page.getByText("Stop could not be confirmed for this execution.",{exact:false})).toBeVisible()
})
test("old producer hides continuous retry while keeping ordinary retry available",async({page})=>{
  const f=await fixture(page,false)
  // Development StrictMode repeats mount effects; production mounts once.
  await expect.poll(()=>f.reads).toBeGreaterThan(0)
  expect(f.reads).toBeLessThanOrEqual(2)
  await expect(page.getByRole("button",{name:"Retry connection until stopped",exact:true})).toHaveCount(0)
  await expect(page.getByRole("button",{name:"Retry generation",exact:true})).toBeEnabled()
  expect(f.writes).toEqual([]);expect(f.runtime.pageErrors).toEqual([])
})
test("fresh negotiation refuses a withdrawn capability without any mutation",async({page})=>{
  const f=await fixture(page,true),action=page.getByRole("button",{name:"Retry connection until stopped",exact:true})
  await expect(action).toBeEnabled();const initialReads=f.reads;f.withdraw();await action.click()
  await expect(page.getByText("This service no longer confirms support for continuous connection retries.",{exact:true})).toBeVisible()
  expect(f.writes).toEqual([]);expect(f.reads).toBe(initialReads+1);expect(f.runtime.pageErrors).toEqual([])
})
