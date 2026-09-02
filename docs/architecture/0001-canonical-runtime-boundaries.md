# ADR 0001: Canonical all-surface runtime boundaries

- Status: Accepted
- Scope: Lotus Next runtime/bootstrap/transport boundary
- Runtime schema: `1`
- Decision owner: Lotus Next

## Context

Lotus Next is one frontend product delivered through five supported surfaces:
standalone browsers, remote browsers, Bamboo embedded web, Bodhi desktop, and
responsive phone/tablet browsers. A host may supply capabilities and bootstrap
inputs, but it must not fork feature logic, state ownership, transports, or
compatibility behavior.

Before this decision, endpoint discovery had two competing paths. An unused
async function performed health probes and legacy fallback, while HTTP and v2
WebSocket singletons synchronously resolved their endpoint during module
evaluation. The synchronous path ran before a host could bootstrap, discarded
the page port, assumed port 9562 on some pages, and was reconstructed a third
time for attachment URLs. Tauri detection was also repeated from raw globals.

## Decision

The dependency direction is:

```text
main composition root
  -> browser/host runtime adapter
  -> immutable RuntimeConfig (schema 1)
  -> HTTP and v2 WebSocket transport adapters
  -> typed feature/domain consumers
```

Only the composition root instantiates concrete runtime behavior. Feature and
domain code depend on typed service contracts. Transport/runtime adapters own
browser location, endpoint-override storage, Vite public input, Tauri bootstrap
signals, `fetch`, and `WebSocket`. Concrete browser, embedded, desktop,
storage, endpoint, and environment APIs do not enter domain behavior.

`src/main.tsx` resolves and installs one recursively frozen `RuntimeConfig`
before it dynamically imports `Root` or any service singleton. Installing an
identical config twice is idempotent; installing a different config fails
closed and requires a complete page/artifact reload. This prevents a running
application from mixing endpoints or host capabilities from two deployments.

### Runtime contract

Runtime schema 1 separates:

- `host`: `browser`, `bamboo-embedded`, or `bodhi-desktop`, plus demonstrated
  native filesystem, notification, external-shell, and sidecar capabilities;
- `endpointSource`: `tauri-sidecar`, `stored-override`,
  `public-build-default`, or `page-origin`;
- `endpoints`: one canonical origin, one native `/api/v1` base, and the
  independently versioned `/v2/stream` endpoint;
- `publicMetadata`: build mode and development status only;
- `artifact`: package name, `VITE_APP_VERSION`, and `VITE_APP_REVISION`;
- `auth`: the currently implemented same-site-cookie
  `credentials: include` boundary, separated from every public build field.

The only endpoint-related public build input is
`VITE_BACKEND_BASE_URL`. Vite variables are client-visible and therefore must
never contain credentials, passwords, API keys, private keys, secrets, or
tokens. The exact public schema contains only `VITE_BACKEND_BASE_URL`,
`VITE_APP_VERSION`, and `VITE_APP_REVISION`. Both the architecture verifier and
the Vite configuration reject every other `VITE_*` name; the build also stops
before bundling if the backend value is not a bare HTTP(S) origin or exact
`/api/v1`, names the historical `/v1` alias, or contains credentials, a query,
a fragment, ASCII control characters, or an ambiguous/arbitrary path spelling.

### Authentication boundary and known pairing gap

Schema 1 does not implement or claim a general remote-device authentication
contract. Today Lotus Next can authenticate only where Bamboo establishes a
same-site cookie. In particular, a remote or mobile client that requires a
device token plus an authenticated v2 WebSocket hello is unsupported. Neither
the HTTP adapter nor the v2 hello accepts credentials from Vite metadata,
endpoint storage, or another public browser input.

A focused cross-module Lotus/Bamboo/Bodhi slice must define secure device
credential provisioning, protected storage, rotation, revocation, HTTP request
attachment, and WSS hello negotiation before that combination can be marked
compatible. Until then, those deployments must fail visibly as an unsupported
authentication/protocol combination; they must not guess credentials, silently
fall back to an unauthenticated stream, or be advertised as covered by the
surface matrix.

### Endpoint selection and validation

The precedence is deterministic:

1. a valid injected sidecar port from a callable Tauri runtime on a non-HTTPS page;
2. a valid stored browser override;
3. a valid public build default;
4. the exact HTTP(S) page origin, including its explicit port.

Every accepted base is normalized to an origin plus `/api/v1`. Its protocol
must be HTTP(S); credentials, query, fragment, and arbitrary path prefixes are rejected.
An HTTPS page cannot select HTTP, and a remotely served page cannot select a
loopback backend. An unsafe stored override is removed and resolution continues;
an unsafe authoritative build or sidecar input fails bootstrap visibly. A
sidecar global without Tauri runtime evidence is ignored.

HTTP-to-WS and HTTPS-to-WSS conversion happens once in the endpoint set and
preserves explicit non-default ports. HTTP clients, the shared v2 WebSocket,
and attachment rendering consume this set; they never reconstruct an origin.
There is no health probe during endpoint selection.

Browser persistence uses `lotus_next_backend_endpoint_v1`. If absent,
`browserRuntime.ts` migrates a safe legacy bare origin, exact `/v1`, or exact
`/api/v1` from `copilot_backend_base_url`: normalize, write, verify, then remove
the old key. Any failure preserves a usable value, emits fixed non-sensitive
diagnostics, and never requests `/v1`. Remove the reader only after every
Bamboo/Bodhi/standalone consumer has passed the migration artifact's rollback window.

## Current ownership inventory

| Concern | Authoritative owner | Current production consumer/entry |
| --- | --- | --- |
| Application bootstrap | `src/main.tsx` | installs runtime, then imports `Root` |
| Endpoint and host resolution | `src/runtime/browserRuntime.ts` | browser globals and safe public input |
| Immutable contract and endpoint derivation | `src/runtime/runtimeConfig.ts` | schema, freeze/install invariants |
| HTTP composition | `src/services/api/index.ts` | creates the only native `ApiClient` from `runtime.endpoints.nativeApi` |
| HTTP transport | `src/services/api/transport.ts` | the only browser `HttpTransport` and direct `fetch` owner |
| Realtime transport | `src/services/chat/v2Stream.ts` | the only `WebSocket` constructor |
| Attachment API URL | `messageMapping.ts` | resolves through the shared canonical native client |
| Host detection facade | `src/utils/environment.ts` | reads runtime host kind only |
| Stored endpoint override and one-time legacy migration | `src/runtime/browserRuntime.ts` | the only storage-key owner |
| Public build metadata | `src/runtime/browserRuntime.ts` | exact public Vite allowlist |

## Supported-surface matrix

| Surface | Bootstrap source | Endpoint source | Auth source | Host capabilities | Artifact identity | Missing integration work |
| --- | --- | --- | --- | --- | --- | --- |
| Standalone local browser | static/Vite page composition root | safe override/build default, otherwise exact page origin and dev proxy | same-site cookie; local Bamboo policy | browser only | the same Lotus Next package version/revision | publish and consumer cutover under the migration tracker |
| Remote HTTPS/WSS browser | deployed page composition root | safe HTTPS override/build default, otherwise exact HTTPS page origin and port | same-site cookie only; device-token pairing and authenticated v2 hello are not implemented | browser only | the same complete deployed artifact | deployment manifest and remote acceptance may cover only same-site-cookie deployments; device auth requires the focused cross-module slice |
| Bamboo embedded web | embedded page/iframe composition root | consumer-provided safe build default or exact embed page origin | Bamboo-served cookie boundary | embedded marker; no invented native capability | the same Lotus Next artifact | Bamboo must embed fail-closed, declare the artifact, and satisfy CSP/routing work in its consumer issue |
| Bodhi desktop | bundled webview composition root | trusted injected non-default sidecar port; unsafe HTTPS-to-HTTP combinations fail | cookie transport to the sidecar | filesystem, notifications, external shell, sidecar | the same bundled Lotus Next artifact plus Bodhi manifest | Bodhi must inject the port before bootstrap and cut over as a whole artifact |
| Responsive phone/tablet browser | the same local or remote browser composition root | the same browser rules; no mobile-only endpoint path | same-site cookie only; mobile device-token pairing is unsupported | browser only; responsive UI is not a host fork | the same desktop-web artifact | responsive parity remains separate; token provisioning/lifecycle and WSS hello require the focused cross-module slice |

## Compatibility matrix

| Boundary | Authoritative owner | Explicit version/capability | Unsupported behavior | Rollback | Retirement condition |
| --- | --- | --- | --- | --- | --- |
| Runtime bootstrap | Lotus Next | `RuntimeConfig.schemaVersion = 1` plus typed host capabilities | a second/different config, invalid host input, or unsafe endpoint stops bootstrap with an actionable screen | select the prior complete artifact and matching manifest | superseded only by a documented next schema and coordinated consumers |
| Native HTTP | Bamboo API + Lotus HTTP adapter | canonical `/api/v1`; cookie credentials | frontend `/v1` routing, arbitrary path prefixes, endpoint reconstruction, or silent cross-origin guesses | roll back frontend and matching Bamboo/Bodhi artifact together | an explicit successor API version replaces `/api/v1` and every consumer migrates |
| Remote/mobile authentication | future coordinated Lotus/Bamboo/Bodhi owner | currently same-site cookie only; no device-token lifecycle or authenticated v2 hello | any deployment requiring device-token pairing is explicitly incompatible and must surface auth/protocol failure | return to a supported same-site deployment and its matching artifact; never expose or persist a token through public runtime input | secure provisioning, protected storage, rotation, revocation, HTTP attachment, and WSS hello ship and are accepted together |
| Realtime | Bamboo v2 protocol + Lotus v2 adapter | `/v2/stream`; JSON default; optional `bamboo.v2.msgpack` subprotocol | no SSE or legacy transport fallback; a missing v2 stream remains visibly unavailable | select a last-known-good full artifact/server pair | negotiated successor capability is shipped and the v2 retirement condition is recorded |
| Bodhi sidecar bootstrap | Bodhi | Tauri capability evidence plus valid injected port | default-port guessing, accepting browser-forged injection, or HTTPS mixed content | restore the matching Bodhi bundle and sidecar | Bodhi consumes a versioned replacement bootstrap contract |
| Bamboo embed | Bamboo consumer | artifact version/revision and runtime schema in the embed manifest | unknown/missing artifact, partial asset mixing, or implicit legacy Lotus fallback | point the embed manifest to the previous complete artifact | all supported Bamboo deployments use the canonical manifest contract |
| Artifact delivery | release train/consumer manifest | Lotus version and revision | mixing chunks/manifests across revisions | atomically select the complete last-known-good artifact and manifest | replaced by a newer complete artifact after acceptance |

Stale locally bundled Bamboo or Bodhi processes are repaired through a
coordinated rebuild/upgrade. Lotus Next does not carry compatibility fallback
for an old process. Cross-version behavior requires an explicit API/protocol
version or negotiated capability and a written removal condition.

## Retain, redesign, delete

### Retain

- same-origin browser delivery and explicit page ports;
- safe, user-selected versioned endpoint overrides;
- one safe public endpoint default for deployments;
- cookie-backed auth kept outside public configuration;
- one shared v2 WebSocket with JSON and negotiated MessagePack;
- demonstrated Bodhi filesystem, notification, external-shell, and sidecar
  capabilities.

### Redesign

- endpoint discovery becomes synchronous composition-time resolution, not
  module-load singleton discovery or an async probe path;
- all native HTTP consumers share one `ApiClient`; native HTTP, WebSocket, and
  attachment URLs derive from one immutable endpoint set;
- raw Tauri detection becomes a runtime host kind for ordinary consumers;
- page-origin derivation preserves protocol and explicit port;
- failures identify endpoint source and artifact identity and require a
  compatible full artifact/server pair.

### Delete

- backend health probing as a configuration mechanism;
- the legacy `/v1/health` probe/fallback;
- every frontend `/v1` request, proxy, client, and endpoint fallback;
- remote-page-to-loopback guesses and an assumed port 9562;
- HTTP/WebSocket/attachment origin reconstruction outside runtime/transport;
- silent fallback to legacy Lotus or a stale local process;
- any compile-time credential/token/secret input.

Compatibility is not a fourth category. A requirement must be retained,
redesigned with an explicit owner, or deleted.

## Enforced boundary and frozen debt

Run:

```bash
node scripts/check-architecture.mjs
npx vitest run scripts/check-architecture.test.mjs
```

The TypeScript-AST checker rejects new endpoint-related Vite access,
endpoint-override storage, Tauri access, direct HTTP/WebSocket/SSE construction,
alternate transport packages, and static runtime `endpoints` reads outside the
designated owners while ignoring comments and string-shaped fake code. It also
checks import aliases, freezes concrete runtime composition APIs to their named
owners, blocks application dependencies from the two pre-install runtime
modules, and verifies the bootstrap control structure. The only accepted
bootstrap is a single unconditional three-statement install, static dynamic
module load, and React render sequence; application imports, re-exports, and
`import.meta.glob` cannot instantiate before installation.
The repository walk separately parses `.env*` public keys and rejects inline
application scripts or a non-module `/src/main.tsx` entry in `index.html`, so
compile-time credentials and alternate entrypoints cannot evade the TypeScript
boundary. Exact file and occurrence budgets freeze raw endpoints,
`import.meta.env`, storage, Tauri, `fetch`, `WebSocket`, client construction, and
runtime endpoint reads. Inline and repository-walk fixtures prove allowed
adapters and rejected feature/domain access. The normal repository verification
script and CI invoke these commands before merge.

The exact pre-existing host-global debt is deliberately narrow:

- `src/services/notification/desktopNotification.ts`: two direct Tauri invoke
  reads for the already-shipped notification adapter;
- `src/shared/utils/openExternalLink.ts`: one direct Tauri invoke read for the
  already-shipped shell adapter;
- `src/shared/services/FileOperationsService.ts`: two Tauri plugin imports for
  the already-shipped file adapter.
- `src/shared/utils/osInfoUtils.ts`: one legacy `__TAURI__` capability check
  used by the already-shipped OS guidance adapter.

These files are adapter debt, not feature permission to add new host access.
The count budget prevents growth. Moving their invocation details behind a
versioned host adapter is follow-up work and does not expand this runtime slice.
Existing non-endpoint development-mode reads are likewise frozen by file and
count; new endpoint/public build access remains exclusive to the runtime
adapter.

Provider configuration is frozen data, not Lotus routing. OpenAI-compatible
`/v1` literals have file/count budgets in `providerPresets.ts`,
`InstanceEditor.tsx`, `src/shared/i18n/index.ts`, `en-US.ts`, and `zh-CN.ts`.
The two locale files also retain frozen, non-executable legacy Bamboo copy as
raw-endpoint debt; neither exception authorizes an executable `/v1` path.

Two parser comparisons are also named exceptions: `browserRuntime.ts` rewrites
one-time legacy storage to `/api/v1` without sending it, while `vite.config.ts`
rejects `/v1` as new build input. Elsewhere, executable native `/v1`, absolute
`/api/v1` or `/v2/stream`, and direct origin composition are rejected outside
the runtime owners.

The verifier scans every supported JavaScript/TypeScript module extension under
`src/`. Production modules cannot import excluded test paths or escape that
source tree through static imports, re-exports, dynamic imports, `require`, or
bundler-style `new URL(..., import.meta.url)` references.

## Failure and rollback contract

Invalid authoritative runtime input stops before feature modules load and
renders an actionable bootstrap error. A reachable but incompatible backend is
shown by the Root reachability/protocol screen and the existing v2 availability
surface; Lotus Next does not silently switch endpoint, protocol, or product.

Rollback means atomically selecting a complete last-known-good frontend
artifact and its matching manifest/server or desktop bundle. It never means
activating a second frontend architecture, mixing asset revisions, probing
legacy health routes, or falling back to the unmaintained Lotus Ant Design UI.
Broad server negotiation and consumer rollback wiring remain follow-up slices
that build on this contract.

## Consequences

All surfaces now share one production bootstrap and transport seam, explicit
configuration provenance, and enforceable ownership. Consumer cutover remains
independent and can proceed in bounded issues. The deliberate cost is stricter
startup: invalid or cross-version combinations surface visibly instead of
appearing to work through an unbounded fallback.
