# Supervisor Project scope over shared HTTP v1

Lotus reads and updates Supervisor Project scope through the same Bamboo HTTP API in a normal browser and in a desktop shell. This supersedes the native-only production gate in the historical 9762d30/817a4a0/cf33d185 candidates. Those commits and their evidence remain preserved.

The user product requirements are that Bodhi is a shell and that the complete business flow works without it. Bamboo owns authentication, request-origin protection, Project validation and management CAS. The minimal single-PUT design is the backend owner's technical implementation decision; it is not a quotation from the user.

## Frozen contract

The backend owner's local contract is `2072-minimal-web-scope-contract-v1.json`, SHA256 `b6204b50a78bee87f47a26ae2e353720a396677591da099cc4fd92839def86cc`. No prepare endpoint, nonce, new login credential or native confirmation is used.

`GET /api/v1/supervisor/default/scope` retains the canonical scope, code, capabilities and note. HTTP writes require `capabilities.project_scope_http_write_v1=true` and `owner_authorization={available:true,required:true,kind:"authenticated_owner",http_registration:false,code:null}`. A false availability preserves `owner_authentication_required`, `owner_authentication_unconfigured` or `owner_authentication_unavailable` explicitly. Legacy `trusted_host_intent` observations remain readable and previewable without enabling a web write.

The user reviews the exact Supervisor incarnation, management revision and complete Project set before confirming. The only PUT body is `{incarnation_id,expected_state_revision,allowed_projects}`. `ApiClient.putOnce` gives this action one transport attempt; the generic PUT retry policy is not used. Success remains `{receipt}`. A separately read canonical state must agree with the validated receipt and selected set before the UI says the current set was saved. A matching GET alone cannot prove a submission with a lost or invalid receipt succeeded.

Bamboo checks existing credentials independently of local bypass/open policy, reads current AccessControl and enforces JSON plus the exact same-backend or explicitly configured origin. Lotus does not set an owner header, fabricate an Origin, turn a UI boolean into proof or invoke Tauri for this business action. Existing password/pairing administration's local-bypass behavior is a separately disclosed existing boundary; this frontend slice does not change that authentication policy.

## Normal interaction and recovery

Opening and editing make no scope write. Preview is local. Closing before submission discards the draft. Confirmation freezes the exact intent and starts one PUT; double activation, stale acknowledgements and conflicting edits are guarded. A 409 reads the current state, preserves the explicit draft and requires another review. Authentication/origin/unavailability refusals are shown precisely and need an explicit reread before another attempt. Ambiguous failures remain unknown and are never automatically replayed.

When Bamboo reports `owner_authentication_required`, the dialog can reuse the existing password-verification form. It verifies a user-entered existing access password through `/api/v1/bamboo/access/verify`, then rereads scope eligibility. It does not create credentials, modify authentication configuration, replay a pending scope request or treat successful verification as a scope grant. Device-only or unconfigured access requires the already-supported configured owner client or an explicit configuration step by the user; Lotus does not automatically provision a device/password.

A Project removal revokes management links. Re-adding does not restore them or attach historical sessions. This management revision remains independent of Work binding revision. No Work initialization, workspace/shell/build grant, Root creation or model action is performed by the scope dialog.

## Focused validation

The new default-HTTP regression failed against the frozen native-only source, then passed with this implementation. Four affected unit/component files pass 83 tests. Type-check, lint, 2234 matching locale keys and architecture checks pass. Existing native-only hook wiring tests are replaced by web/default wiring coverage; the adapter's historical source and tests remain in Git. The old 251-unit/33-browser batch is not rerun or relabelled as this candidate's validation.

The new built-browser selection covers a plain page with no Tauri globals, owner-ready confirmation, local close/reopen, three authentication states, existing-password verification with a fixture HttpOnly cookie, conflict, Origin refusal, 503 and lost-response behavior. These use framework-injected owner/API responses, not real Bamboo authentication or actual user grants. Build/browser results will be recorded in the local delivery receipt once executed.

Actual current-source Bamboo HTTP integration is pending the backend owner's implementation and shared Rust window. The existing running fixture has no proven configured owner authentication; its local bypass is insufficient. No credential, permission or user security configuration is created to make that integration pass. No Rust build, actual model, native prompt, scope grant, push, merge or publication is part of this frontend validation.
