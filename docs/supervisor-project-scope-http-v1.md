# Supervisor Project scope over shared HTTP v1

Lotus uses the same Bamboo scope API in a browser and a desktop shell. Bodhi supplies the shell; Bamboo owns scope business rules and management CAS. The final user direction preserves the existing access/authentication mode. It supersedes the native-only gate and the extra owner-login/Origin policy proposed in the historical `b32d8ccf` candidate. Those frozen artifacts and test evidence remain preserved.

## Current contract

After the existing access gate, `GET /api/v1/supervisor/default/scope` returns the canonical scope plus `capabilities.project_scope_http_write_v1=true` and `owner_authorization={available:true,required:true,kind:"existing_access",http_registration:false,code:null}`. Lotus consumes that result. It does not derive permission from a hostname, an optional method field, a native bridge, or a separate scope password form. Optional response metadata is normalized away. Legacy `trusted_host_intent` observations remain readable and previewable without enabling an unsupported HTTP write.

The user reviews the exact Supervisor incarnation, management revision and complete Project set, then explicitly confirms. The PUT body remains `{incarnation_id,expected_state_revision,allowed_projects}`. `ApiClient.putOnce` sends one transport attempt. Success remains `{receipt}`; the validated receipt and a separate fresh GET must agree before the UI reports the selected set saved. A matching GET cannot prove the outcome of a lost or invalid receipt.

This change removes the scope-specific password button, verifier call and new owner-authentication states introduced in `b32d8ccf`. The global `PasswordGate` is restored byte-for-byte to its pre-scope source. Existing application access handling, middleware, credentials and configuration are unchanged. The scope client adds no new login, Origin, loopback, prepare/nonce or native-confirmation protocol. Ordinary HTTP refusals still appear as failures without a scope-login form or automatic replay.

## Interaction and recovery

Opening, selecting and previewing make no write. Closing before submission discards the draft. A 409 reads the current state and requires a fresh review; the explicit selection is retained. Unknown outcomes, including `503 scope_outcome_unconfirmed`, remain unknown after GET and are never replayed automatically. A new review is required for another deliberate attempt. Receipt, incarnation and revision checks remain unchanged.

Removing a Project revokes management links; adding it again does not revive links or attach historical sessions. Management revision remains independent of Work binding revision. The dialog does not initialize Work, grant workspace/shell/build access, create a Root or invoke a model.

## Local evidence

Two new existing-access regressions failed on the old decoder/confirmation gate before the minimal change. Only affected DTO, dialog, shared-HTTP wiring and outcome regressions are selected for this delta; the previous 83/22 suite is not repeated. The built-browser fixture uses `local_bypass` bootstrap and an explicit `existing_access` response without cookies or Tauri. It covers direct review/confirmation, closing before submit, a global access refusal and post-CAS unknown handling. Fixture results are separate from actual current-source Bamboo acceptance.

The source, build, manifest, selected results and remaining real-backend dependency are recorded in the local delivery receipt. No actual user grant, password/security configuration, backend source, Rust build, push, merge or publication is performed by this frontend work.
