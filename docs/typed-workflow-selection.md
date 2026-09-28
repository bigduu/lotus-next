# Typed Workflow selection (#198)

Lotus Next submits an explicit catalog selection through the existing authenticated HTTP transport. The backend catalog and its pinned activation remain authoritative.

## Producer contract

Verified from Bamboo integration `6b5f5db53c811fe0ef536d461d846cf37aa49d4e`, unchanged by later Inbox-only integration commits:

- `GET /api/v1/bamboo/workflow-catalog?session_id=<exact existing Session>` resolves persisted Project/workspace authority. Without a Session, the public endpoint returns the global catalog. New-session Project/workspace discovery is outside this slice; chat admission revalidates the actual context.
- The metadata response is `{revision, entries}`. Entry `id`, `source`, positive safe-integer `revision`, `status`, `winner`, `kind`, `invocation_policy.explicit` and `argument_schema` are consumed. The outer catalog revision is not substituted for the selected entry revision.
- Public entries can be instruction or orchestration. `POST /api/v1/chat` accepts only a valid winning instruction entry allowing explicit activation. Orchestration entries need the separate Workflow Run API and are visible but unavailable here.
- Chat sends `workflow_selection: {id, source, revision, args}`. Instructions, paths and catalog metadata are never sent as selection authority. Existing Root chats omit `root_orchestration_only`.
- The submission helper checks JSON arguments against Bamboo's current small schema vocabulary (`domain/workflow/schema.rs`): type/union, enum, required/properties/additionalProperties, items, numeric bounds and typed secret capability handles. Unsupported or malformed schemas cannot be submitted. This provides local feedback; it does not replace backend validation of the immutable pinned definition.
- Arguments must remain JSON-representable: non-finite numbers and integers outside JavaScript's safe range are explicitly rejected, including under an empty schema, to avoid silently changing values during HTTP serialization.
- Bamboo typed rejection codes include `workflow_revision_missing`, `workflow_revision_mismatch`, `workflow_source_mismatch`, `workflow_manual_only`, `workflow_selection_invalid`, `workflow_snapshot_unavailable`, `workflow_snapshot_too_large`, `workflow_context_invalid` and `root_orchestration_incompatible_mode`.

## Composer behavior

- Opening the typed picker lazily reads the authenticated public catalog. Refresh reads metadata again but never silently changes an existing selected identity/source/revision. Users explicitly reselect after a stale rejection.
- Selection and JSON parameters are local to the current composer, not persisted into old drafts or restored after reload. Switching Sessions clears the typed selection. Draft text keeps its existing persistence and revision semantics.
- A typed rejection preserves draft and exact selected version. Existing Root detail is read back without switching its durable mode. The user explicitly disables Root-only mode before retrying a conflicting Workflow.
- Typed selection requires a message or image and cannot be converted to guidance queue text during an active run. A newer selection is retained across an older admission acknowledgement.
- Slash-command Workflows retain the existing Markdown expansion behavior, labeled “文本展开”. Selecting one explicitly replaces the typed choice; a late expansion response cannot overwrite a newer choice.

## Delivery identity

The isolated #198 branch starts from reviewed #199 source `3b39cee6ef10790a0cfdab8d440d671ae5349687` (tree `378db61f961f9e245d3937d1de289cfbe4437bad`). Root subsequently accepted #199 and merged Lotus Next integration `4d0a100d70ba3ebe28e60390ca76c84bc1f87cf1` with that exact tree after Bamboo #1337 acceptance. Accept the #198 delta from its recorded dependency base separately.

No Workflow Run API, catalog mutation, Bamboo change, actor tree/subscription change, Project discovery or Root authority protocol is added.
