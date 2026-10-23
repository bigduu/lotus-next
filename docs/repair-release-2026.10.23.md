# Repair release 2026.10.23 preparation

This candidate pairs the accepted Lotus Next application with Bamboo
`80815125da51a5722935e99fda2ed4541aa67f98`. That normally merged backend includes
the retry diagnostic, ordinary Workspace handoff and setup/Core write repairs.
The frontend application sources remain those reviewed in PR400 at
`2a15589ae6bb0ea5a515ee9056d113213fd657f4`, merged as
`3f8af24e9c095026ca95aa5ed7334ef6e27be369`. This preparation updates the exact
backend acceptance pins and passes the verified publication version/source to
the frontend's existing public runtime metadata.

The diagnostics UI displays the backend's available receipt and exports only
the defined allowlist. A new run, conversation change or refresh reconciles its
own canonical diagnostic. Missing data remains missing; frontend exports do not
infer backend authority or issue another model request.

The retained local combination acceptance used Bamboo `0b3c7315` and the PR400
frontend snapshot: actual SSE, WebSocket and canonical diagnostic identity,
cold restart persistence and seven UI assertions passed, with twelve synthetic
provider requests and zero paid calls. The chat-only terminal replay observation
was unconfirmed and is not counted as passing. That receipt retains its original
source identities; it does not prove a later build. The new backend's necessary
setup path is verified separately after its source-bound CLI is available.

Formal publication is still pending. The package source version stays `0.0.0`.
Before publishing the unused immutable `2026.10.23` identity, run the existing
exact-source Node22/24, package and real-Bamboo browser gates, normally merge
the source and reviewed immutable tag/acceptance registration, and use the
canonical publisher. Its final tarball must match the accepted browser bytes
and the registry readback. No consumer lock, historical release or platform
scope changes in this source preparation.
