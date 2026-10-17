# Session host versus Actor execution location

Investigated against Lotus Next `d54cfea5cc2dfb03bad4db1a055186d0713313d4`
and freshly fetched Bamboo `da348a63f1d019a22df547c78575c500b6b1294e`.

## Current evidence

- Session summary `placement.kind` / `placement.host` describes the session's
  deployment host. Bamboo's
  [sessions/types.rs](https://github.com/bigduu/Bamboo-agent/blob/da348a63f1d019a22df547c78575c500b6b1294e/crates/app/bamboo-server/src/handlers/agent/sessions/types.rs#L244)
  supplies the backend's local hostname for unstamped sessions. Lotus Next's
  `sessionSummaryToChatItem` preserves this object; Environment displays it.
  “Local” here is relative to the Bamboo backend, not the browser/device.
- The right-side Actor tree uses the separate authorized Actor snapshot.
  [actor_snapshot.rs](https://github.com/bigduu/Bamboo-agent/blob/da348a63f1d019a22df547c78575c500b6b1294e/crates/infra/bamboo-storage/src/v2/actor_snapshot.rs#L744)
  projects `nodes[].placement_class` **only** from
  `activation.placement_ref.class`. Missing activation or placement reference
  produces null. This is deliberate, rather than a dropped frontend field.
- Native task diagnostics can coexist with null placement.
  [local_task_observation](https://github.com/bigduu/Bamboo-agent/blob/da348a63f1d019a22df547c78575c500b6b1294e/crates/infra/bamboo-storage/src/v2/actor_snapshot.rs#L329)
  checks the child/activation/run/birth evidence and Local intent; an absent
  concrete placement reference is allowed. The public
  [local_task DTO](https://github.com/bigduu/Bamboo-agent/blob/da348a63f1d019a22df547c78575c500b6b1294e/crates/core/bamboo-domain/src/session/actor_snapshot.rs#L146)
  reports state, reason, observation time and lease expiry. It does not publish
  a host identity or a concrete execution binding.
- Workspace is a filesystem path. Neither it, browser localhost, session host,
  nor placement intent proves the execution location of a particular activation.

## Frontend scope

The tree retains unknown placement in its data model, but displays “Location not
reported” with accessible explanations for absent activation, native task
evidence without placement, and other missing placement. Known placement classes
remain unchanged. Tests use the public v1/v2 fixtures, preserve null, cover all
reported classes, and ensure a workspace does not manufacture a Local label.

This improves the missing-data presentation; it does **not** resolve the backend
execution-location gap or discover a physical host.

## Minimal backend follow-up boundary

A concrete location needs authoritative execution binding, not an inference from
the public `local_task` flag. Bind an actual native execution admission to its
activation ID/attempt, run and child birth, and a backend execution-host identity.
Validate that binding under the same snapshot consistency/fencing rules before
publishing a placement class. Missing, stale, replaced, foreign or mismatched
bindings must remain null. Explicitly distinguish historical placement from
currently running/liveness claims.

Prefer a valid concrete activation placement reference if the native admission
path can establish it under the existing contract. If only execution-observation
evidence is available, use a separately negotiated, versioned public field with
documented provenance and “local to this Bamboo runtime” semantics. Do not change
the exact v1 response/identity or silently equate Local intent with placement.

Publishing a physical hostname is a separate privacy/API decision: the current
Actor snapshot intentionally excludes hosts/endpoints. A class-only fix must not
expose private runtime IDs, paths, credentials or broker addresses. Backend
regressions should include missing binding, native running/stopped/expired,
activation replacement, remote/SSH/Docker, and legacy roots before frontend
adoption. No backend change or Rust execution is included in this patch.
