import { execFile, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  chown,
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REAL_BAMBOO_REVISION = "49c6f3b8b4d0f72674f888aa3abcef7cd91cd372";

const REAL_BAMBOO_MODEL = "gpt-4o-mini";
const REAL_BAMBOO_PROVIDER = "e2e-openai";
const BAMBOO_CONTAINER_PORT = 9562;
const PROVIDER_CONTAINER_PORT = 18_080;
const PRIMARY_PROJECT_CONTAINER_PATH = "/data/bamboo/workspaces/primary";
const SECONDARY_PROJECT_CONTAINER_PATH = "/data/bamboo/workspaces/secondary";
const COMMAND_BUFFER_BYTES = 256 * 1024 * 1024;
const READY_TIMEOUT_MS = 90_000;
const PROVIDER_READY_TIMEOUT_MS = 15_000;
const CHILD_TERMINATION_GRACE_MS = 1_500;
const CLEANUP_COMMAND_TIMEOUT_MS = 15_000;

const SUPPORT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SUPPORT_ROOT, "../..");
const DIST_ROOT = path.join(REPOSITORY_ROOT, "dist");
const DOCKERFILE_PATH = path.join(SUPPORT_ROOT, "Dockerfile.real-bamboo");
const PROVIDER_SCRIPT_PATH = path.join(SUPPORT_ROOT, "realBambooProvider.py");
const PROVIDER_BUILD_CONTEXT_FILENAME = ".lotus-real-bamboo-provider.py";
const PROVIDER_OBSERVATIONS_FILENAME = "provider-observations.json";
const EVIDENCE_BASE = path.join(
  REPOSITORY_ROOT,
  "test-results-real-bamboo",
  "evidence",
);

const EXPORTED_ENVIRONMENT_KEYS = [
  "LOTUS_REAL_BAMBOO_BASE_URL",
  "LOTUS_REAL_BAMBOO_SESSION_ID",
  "LOTUS_REAL_BAMBOO_MEMORY_SESSION_ID",
  "LOTUS_REAL_BAMBOO_OTHER_PROJECT_SESSION_ID",
  "LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH",
  "LOTUS_REAL_USER_MARKER",
  "LOTUS_REAL_ASSISTANT_MARKER",
  "LOTUS_REAL_BAMBOO_REVISION",
] as const;

type ExportedEnvironmentKey = (typeof EXPORTED_ENVIRONMENT_KEYS)[number];
type JsonObject = Record<string, unknown>;

export interface ProviderRequestObservation {
  readonly sequence: number;
  readonly method: string;
  readonly path: string;
  readonly model: string | null;
  readonly stream: boolean;
  readonly userMarkerPresent: boolean;
  readonly smokeMarkerPresent: boolean;
}

export interface ProviderObservations {
  readonly schemaVersion: 1;
  readonly userMarker: string;
  readonly assistantMarker: string;
  readonly requestCount: number;
  readonly requests: ProviderRequestObservation[];
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface SourceValidation {
  readonly directory: string;
  readonly head: string;
  readonly clean: true;
}

interface ContainerIdentity {
  readonly uid: number;
  readonly gid: number;
  readonly user: string;
  readonly requiresHostChown: boolean;
}

interface RuntimeState {
  stage: string;
  runId: string;
  evidenceRoot: string;
  tempRoot?: string;
  tempRootOwned: boolean;
  runtimeDataRoot?: string;
  containerId?: string;
  containerName?: string;
  containerCreateAttempted: boolean;
  providerContainerId?: string;
  providerContainerName?: string;
  providerContainerCreateAttempted: boolean;
  networkName?: string;
  networkCreateAttempted: boolean;
  providerObservationsDirectory?: string;
  providerObservationsPath?: string;
  fakeApiKey?: string;
  builtImage?: string;
  imageBuildAttempted: boolean;
  runtimeImage?: string;
  sourceValidation?: SourceValidation;
  imageRevision?: string;
  containerUser?: string;
  containerUid?: number;
  containerGid?: number;
  requiresHostChown: boolean;
  baseUrl?: string;
  sessionId?: string;
  memorySessionId?: string;
  otherProjectSessionId?: string;
  projectId?: string;
  otherProjectId?: string;
  userMarker?: string;
  assistantMarker?: string;
  smokeMarker?: string;
  dockerServerVersion?: string;
  failureEvidencePromise?: Promise<void>;
  cleanupPromise?: Promise<string[]>;
  signalCleanupPromise?: Promise<void>;
  interruptedSignal?: NodeJS.Signals;
  runtimeReadyForTests: boolean;
  signalHandlers?: ReadonlyMap<NodeJS.Signals, () => void>;
  suspendedSigintListeners?: readonly NodeJS.SignalsListener[];
  environmentBefore: Map<ExportedEnvironmentKey, string | undefined>;
}

const activeChildCommands = new Set<ChildProcess>();

const throwIfInterrupted = (state: RuntimeState): void => {
  if (state.interruptedSignal) {
    throw new Error(`Harness interrupted by ${state.interruptedSignal}`);
  }
};

const advanceStage = (state: RuntimeState, stage: string): void => {
  throwIfInterrupted(state);
  state.stage = stage;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const truncateTail = (value: string, maxLength = 12_000): string =>
  value.length <= maxLength ? value : value.slice(value.length - maxLength);

const redact = (value: string, secrets: Array<string | undefined>): string => {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
};

const runCommand = async (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
  } = {},
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    let child: ChildProcess;
    child = execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: COMMAND_BUFFER_BYTES,
        timeout: options.timeoutMs,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        activeChildCommands.delete(child);
        const result = { stdout, stderr };
        if (!error) {
          resolve(result);
          return;
        }

        const diagnostic = truncateTail(
          [result.stderr, result.stdout].filter(Boolean).join("\n"),
        );
        const reason =
          error.code === undefined
            ? "unknown error"
            : `exit ${String(error.code)}`;
        reject(
          new Error(
            diagnostic
              ? `${command} failed (${reason}):\n${diagnostic}`
              : `${command} failed (${reason})`,
          ),
        );
      },
    );
    activeChildCommands.add(child);
  });

const waitForChildExit = async (
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    child.once("exit", finish);
  });
};

const terminateActiveChildCommands = async (): Promise<void> => {
  const children = [...activeChildCommands].filter(
    (child) => child.exitCode === null && child.signalCode === null,
  );
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) =>
      waitForChildExit(child, CHILD_TERMINATION_GRACE_MS),
    ),
  );
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  await Promise.all(
    children.map((child) =>
      waitForChildExit(child, CHILD_TERMINATION_GRACE_MS),
    ),
  );
};

const commandCleanupError = async (
  command: string,
  args: readonly string[],
): Promise<string | null> => {
  try {
    await runCommand(command, args, {
      timeoutMs: CLEANUP_COMMAND_TIMEOUT_MS,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const writeEvidence = async (
  state: RuntimeState,
  name: string,
  value: unknown,
): Promise<void> => {
  await mkdir(state.evidenceRoot, { recursive: true, mode: 0o700 });
  await chmod(state.evidenceRoot, 0o700);
  await writeFile(
    path.join(state.evidenceRoot, name),
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(path.join(state.evidenceRoot, name), 0o600);
};

const writeTextEvidence = async (
  state: RuntimeState,
  name: string,
  value: string,
): Promise<void> => {
  await mkdir(state.evidenceRoot, { recursive: true, mode: 0o700 });
  await chmod(state.evidenceRoot, 0o700);
  await writeFile(
    path.join(state.evidenceRoot, name),
    value.endsWith("\n") ? value : `${value}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(path.join(state.evidenceRoot, name), 0o600);
};

const writeEvidenceSync = (
  state: RuntimeState,
  name: string,
  value: unknown,
): void => {
  mkdirSync(state.evidenceRoot, { recursive: true, mode: 0o700 });
  chmodSync(state.evidenceRoot, 0o700);
  const evidencePath = path.join(state.evidenceRoot, name);
  writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(evidencePath, 0o600);
};

const writeTextEvidenceSync = (
  state: RuntimeState,
  name: string,
  value: string,
): void => {
  mkdirSync(state.evidenceRoot, { recursive: true, mode: 0o700 });
  chmodSync(state.evidenceRoot, 0o700);
  const evidencePath = path.join(state.evidenceRoot, name);
  writeFileSync(evidencePath, value.endsWith("\n") ? value : `${value}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(evidencePath, 0o600);
};

const ensureProductionArtifact = async (): Promise<void> => {
  const indexPath = path.join(DIST_ROOT, "index.html");
  let indexStat;
  try {
    indexStat = await stat(indexPath);
  } catch {
    throw new Error(
      `Lotus production artifact is missing at ${indexPath}. Run the production build before the real-Bamboo suite.`,
    );
  }
  if (!indexStat.isFile()) {
    throw new Error(
      `Lotus production artifact entry is not a file: ${indexPath}`,
    );
  }
};

const ensureDocker = async (): Promise<string> => {
  try {
    const { stdout } = await runCommand("docker", [
      "version",
      "--format",
      "{{.Server.Version}}",
    ]);
    const version = stdout.trim();
    if (!version) throw new Error("Docker returned an empty server version");
    return version;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `A running Docker daemon is required for real Bamboo E2E: ${detail}`,
    );
  }
};

const validateSourceDirectory = async (
  configuredDirectory: string,
): Promise<SourceValidation> => {
  const directory = await realpath(path.resolve(configuredDirectory)).catch(
    () => {
      throw new Error(
        `BAMBOO_E2E_SOURCE_DIR does not exist: ${configuredDirectory}`,
      );
    },
  );

  const { stdout: headOutput } = await runCommand("git", [
    "-C",
    directory,
    "rev-parse",
    "HEAD^{commit}",
  ]).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `BAMBOO_E2E_SOURCE_DIR is not a readable Git checkout: ${detail}`,
    );
  });
  const head = headOutput.trim();
  if (head !== REAL_BAMBOO_REVISION) {
    throw new Error(
      `BAMBOO_E2E_SOURCE_DIR must be exactly Bamboo ${REAL_BAMBOO_REVISION}; found ${head || "<empty>"}.`,
    );
  }

  const { stdout: statusOutput } = await runCommand("git", [
    "-C",
    directory,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (statusOutput.length > 0) {
    const sample = statusOutput
      .trimEnd()
      .split(/\r?\n/u)
      .slice(0, 20)
      .join("\n");
    throw new Error(
      `BAMBOO_E2E_SOURCE_DIR must be completely clean, including untracked files. git status --porcelain reported:\n${sample}`,
    );
  }

  return { directory, head, clean: true };
};

const inspectImageRevision = async (image: string): Promise<string> => {
  let revision: string;
  try {
    const { stdout } = await runCommand("docker", [
      "image",
      "inspect",
      "--format",
      '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
      image,
    ]);
    revision = stdout.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The harness-built Bamboo image could not be inspected: ${detail}`,
    );
  }

  if (revision !== REAL_BAMBOO_REVISION) {
    throw new Error(
      `Docker image ${image} must have OCI label org.opencontainers.image.revision=${REAL_BAMBOO_REVISION}; found ${revision || "<missing>"}.`,
    );
  }
  return revision;
};

const createExactSourceArchive = async (
  state: RuntimeState,
  source: SourceValidation,
): Promise<string> => {
  if (!state.tempRoot)
    throw new Error("Internal error: temporary root is not initialized");

  const archivePath = path.join(state.tempRoot, "bamboo-source.tar");
  const contextPath = path.join(state.tempRoot, "bamboo-source");
  await mkdir(contextPath);
  await runCommand("git", [
    "--no-replace-objects",
    "-C",
    source.directory,
    "archive",
    "--format=tar",
    `--output=${archivePath}`,
    REAL_BAMBOO_REVISION,
  ]);
  throwIfInterrupted(state);
  await runCommand("tar", ["-xf", archivePath, "-C", contextPath]);
  throwIfInterrupted(state);
  await rm(archivePath, { force: true });
  throwIfInterrupted(state);
  // Keep the Bamboo source provenance exact while adding the harness-owned
  // deterministic provider as an explicit, auditable test-only build input.
  await copyFile(
    PROVIDER_SCRIPT_PATH,
    path.join(contextPath, PROVIDER_BUILD_CONTEXT_FILENAME),
  );
  throwIfInterrupted(state);
  return contextPath;
};

const buildPinnedBambooImage = async (
  state: RuntimeState,
  source: SourceValidation,
): Promise<string> => {
  const contextPath = await createExactSourceArchive(state, source);
  throwIfInterrupted(state);
  if (!state.builtImage || !state.runtimeImage) {
    throw new Error(
      "Internal error: Bamboo image name must be recorded before build",
    );
  }
  const image = state.builtImage;
  try {
    state.imageBuildAttempted = true;
    await runCommand("docker", [
      "build",
      "--file",
      DOCKERFILE_PATH,
      "--tag",
      image,
      "--label",
      `lotus.real-bamboo.run=${state.runId}`,
      contextPath,
    ]);
    throwIfInterrupted(state);
  } finally {
    await rm(contextPath, { recursive: true, force: true });
  }

  throwIfInterrupted(state);
  const revision = await inspectImageRevision(image);
  throwIfInterrupted(state);
  state.imageRevision = revision;
  return image;
};

const nonRootContainerIdentity = (): ContainerIdentity => {
  const hostUid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  const hostGid =
    typeof process.getgid === "function" ? process.getgid() : undefined;
  if (
    hostUid !== undefined &&
    hostUid > 0 &&
    hostGid !== undefined &&
    hostGid >= 0
  ) {
    return {
      uid: hostUid,
      gid: hostGid,
      user: `${hostUid}:${hostGid}`,
      requiresHostChown: false,
    };
  }
  return {
    uid: 10_001,
    gid: 10_001,
    user: "10001:10001",
    requiresHostChown: hostUid === 0,
  };
};

const applyContainerOwnership = async (
  state: RuntimeState,
  target: string,
): Promise<void> => {
  if (!state.requiresHostChown) return;
  if (state.containerUid === undefined || state.containerGid === undefined) {
    throw new Error("Internal error: container ownership is not initialized");
  }
  await chown(target, state.containerUid, state.containerGid);
};

const createBambooConfig = (fakeApiKey: string): Record<string, unknown> => ({
  setup: {
    completed: true,
    completed_at: "1970-01-01T00:00:00Z",
    version: 1,
  },
  features: { provider_model_ref: true },
  provider_instances: {
    [REAL_BAMBOO_PROVIDER]: {
      provider_type: "openai",
      label: "Lotus real Bamboo E2E",
      api_key: fakeApiKey,
      base_url: `http://127.0.0.1:${PROVIDER_CONTAINER_PORT}/v1`,
      model: REAL_BAMBOO_MODEL,
      fast_model: REAL_BAMBOO_MODEL,
      enabled: true,
    },
  },
  default_provider_instance: REAL_BAMBOO_PROVIDER,
  defaults: {
    chat: { provider: REAL_BAMBOO_PROVIDER, model: REAL_BAMBOO_MODEL },
    fast: { provider: REAL_BAMBOO_PROVIDER, model: REAL_BAMBOO_MODEL },
  },
  memory: {
    background_model: null,
    auto_dream_enabled: false,
    project_prompt_injection: false,
    relevant_recall: false,
    relevant_recall_rerank: false,
    project_first_dream: false,
    ledger_agenda_injection: false,
    ledger_gardener_enabled: false,
    ledger_distillation_enabled: false,
    gardener_enabled: false,
    dedup_gardener_enabled: false,
    memory_active_capacity: 0,
    granularity_freshness_gardener_enabled: false,
  },
});

const writeBambooConfig = async (state: RuntimeState): Promise<void> => {
  if (!state.runtimeDataRoot || !state.fakeApiKey) {
    throw new Error(
      "Internal error: credential and temporary root must exist before config",
    );
  }
  const bambooDataRoot = path.join(state.runtimeDataRoot, "bamboo");
  await mkdir(bambooDataRoot, { recursive: true, mode: 0o700 });
  await chmod(state.runtimeDataRoot, 0o700);
  await chmod(bambooDataRoot, 0o700);
  const configPath = path.join(bambooDataRoot, "config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(createBambooConfig(state.fakeApiKey), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(configPath, 0o600);
  await applyContainerOwnership(state, state.runtimeDataRoot);
  await applyContainerOwnership(state, bambooDataRoot);
  await applyContainerOwnership(state, configPath);
};

const prepareProjectWorkspaces = async (state: RuntimeState): Promise<void> => {
  if (!state.runtimeDataRoot) {
    throw new Error("Internal error: runtime data root is not initialized");
  }

  // Docker sets BAMBOO_WORKSPACE_ROOT=/data/bamboo/workspaces, which enables
  // confinement. Project paths must already live below that exact root;
  // otherwise Bamboo correctly redirects the candidate and rejects it as a
  // non-authoritative project_path.
  const projectWorkspacesRoot = path.join(
    state.runtimeDataRoot,
    "bamboo",
    "workspaces",
  );
  const primary = path.join(projectWorkspacesRoot, "primary");
  const secondary = path.join(projectWorkspacesRoot, "secondary");
  await mkdir(primary, { recursive: true, mode: 0o700 });
  await mkdir(secondary, { recursive: true, mode: 0o700 });
  await chmod(projectWorkspacesRoot, 0o700);
  await chmod(primary, 0o700);
  await chmod(secondary, 0o700);
  await applyContainerOwnership(state, projectWorkspacesRoot);
  await applyContainerOwnership(state, primary);
  await applyContainerOwnership(state, secondary);
};

const publishedBambooPort = async (containerId: string): Promise<number> => {
  const { stdout } = await runCommand("docker", [
    "port",
    containerId,
    `${BAMBOO_CONTAINER_PORT}/tcp`,
  ]);
  const match = stdout.match(/127\.0\.0\.1:(\d+)/u);
  if (!match) {
    throw new Error(
      `Docker did not publish Bamboo on loopback: ${stdout.trim() || "<empty>"}`,
    );
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Docker reported an invalid Bamboo host port: ${match[1]}`);
  }
  return port;
};

const createPrivateNetwork = async (state: RuntimeState): Promise<void> => {
  if (!state.networkName) {
    throw new Error(
      "Internal error: Docker network name must be recorded before creation",
    );
  }
  state.networkCreateAttempted = true;
  const { stdout } = await runCommand("docker", [
    "network",
    "create",
    "--driver",
    "bridge",
    "--label",
    `lotus.real-bamboo.run=${state.runId}`,
    state.networkName,
  ]);
  if (!/^[0-9a-f]{12,64}\s*$/u.test(stdout)) {
    throw new Error(
      `Docker returned an invalid network id: ${stdout.trim() || "<empty>"}`,
    );
  }
};

const assertProviderHasNoPublishedPorts = async (
  containerId: string,
  bambooContainerId: string,
): Promise<void> => {
  const { stdout } = await runCommand("docker", [
    "container",
    "inspect",
    "--format",
    "{{json .HostConfig.PortBindings}}",
    containerId,
  ]);
  const bindings = stdout.trim();
  if (bindings !== "null" && bindings !== "{}") {
    throw new Error(
      `The deterministic provider must not publish host ports; Docker reported ${bindings || "<empty>"}`,
    );
  }

  const { stdout: networkModeOutput } = await runCommand("docker", [
    "container",
    "inspect",
    "--format",
    "{{.HostConfig.NetworkMode}}",
    containerId,
  ]);
  const networkMode = networkModeOutput.trim();
  if (networkMode !== `container:${bambooContainerId}`) {
    throw new Error(
      `The deterministic provider must share only Bamboo's network namespace; Docker reported ${networkMode || "<empty>"}`,
    );
  }
};

const startProviderContainer = async (state: RuntimeState): Promise<void> => {
  if (
    !state.providerContainerName ||
    !state.containerId ||
    !state.providerObservationsDirectory ||
    !state.providerObservationsPath ||
    !state.runtimeImage ||
    !state.containerUser ||
    !state.fakeApiKey ||
    !state.userMarker ||
    !state.assistantMarker ||
    !state.smokeMarker
  ) {
    throw new Error(
      "Internal error: provider container resources must be recorded before startup",
    );
  }

  state.providerContainerCreateAttempted = true;
  const { stdout } = await runCommand("docker", [
    "run",
    "--detach",
    "--name",
    state.providerContainerName,
    "--label",
    `lotus.real-bamboo.run=${state.runId}`,
    "--network",
    `container:${state.containerId}`,
    "--mount",
    `type=bind,source=${state.providerObservationsDirectory},target=/observations`,
    "--env",
    `LOTUS_REAL_PROVIDER_API_KEY=${state.fakeApiKey}`,
    "--env",
    `LOTUS_REAL_PROVIDER_USER_MARKER=${state.userMarker}`,
    "--env",
    `LOTUS_REAL_PROVIDER_ASSISTANT_MARKER=${state.assistantMarker}`,
    "--env",
    `LOTUS_REAL_PROVIDER_SMOKE_MARKER=${state.smokeMarker}`,
    "--env",
    `LOTUS_REAL_PROVIDER_PORT=${PROVIDER_CONTAINER_PORT}`,
    "--env",
    `LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH=/observations/${PROVIDER_OBSERVATIONS_FILENAME}`,
    "--user",
    state.containerUser,
    "--entrypoint",
    "python3",
    state.runtimeImage,
    "/usr/local/libexec/lotus-real-bamboo-provider.py",
  ]);
  const containerId = stdout.trim();
  if (!/^[0-9a-f]{12,64}$/u.test(containerId)) {
    throw new Error(
      `Docker returned an invalid provider container id: ${containerId || "<empty>"}`,
    );
  }
  state.providerContainerId = containerId;
  await assertProviderHasNoPublishedPorts(containerId, state.containerId);
};

const sanitizeProviderObservations = (
  state: RuntimeState,
  value: unknown,
): ProviderObservations => {
  if (!state.userMarker || !state.assistantMarker) {
    throw new Error("Internal error: provider markers are not initialized");
  }
  const parsed = value;
  if (
    !isJsonObject(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.userMarker !== state.userMarker ||
    parsed.assistantMarker !== state.assistantMarker ||
    !Number.isInteger(parsed.requestCount) ||
    !Array.isArray(parsed.requests) ||
    parsed.requestCount !== parsed.requests.length
  ) {
    throw new Error(
      "Provider observation file did not satisfy the schemaVersion=1 contract",
    );
  }

  const requests = parsed.requests.map((entry, index) => {
    if (
      !isJsonObject(entry) ||
      entry.sequence !== index + 1 ||
      entry.method !== "POST" ||
      entry.path !== "/v1/chat/completions" ||
      (entry.model !== null && entry.model !== REAL_BAMBOO_MODEL) ||
      typeof entry.stream !== "boolean" ||
      typeof entry.userMarkerPresent !== "boolean" ||
      typeof entry.smokeMarkerPresent !== "boolean"
    ) {
      throw new Error(
        `Provider observation request ${index + 1} did not satisfy the redacted schema`,
      );
    }
    return {
      sequence: entry.sequence,
      method: entry.method,
      path: entry.path,
      model: entry.model,
      stream: entry.stream,
      userMarkerPresent: entry.userMarkerPresent,
      smokeMarkerPresent: entry.smokeMarkerPresent,
    } satisfies ProviderRequestObservation;
  });

  return {
    schemaVersion: 1,
    userMarker: state.userMarker,
    assistantMarker: state.assistantMarker,
    requestCount: requests.length,
    requests,
  };
};

const readProviderObservations = async (
  state: RuntimeState,
): Promise<ProviderObservations> => {
  if (!state.providerObservationsPath) {
    throw new Error(
      "Internal error: provider observation path is not initialized",
    );
  }
  return sanitizeProviderObservations(
    state,
    JSON.parse(
      await readFile(state.providerObservationsPath, "utf8"),
    ) as unknown,
  );
};

const waitForProviderReadiness = async (state: RuntimeState): Promise<void> => {
  if (!state.providerObservationsPath) {
    throw new Error(
      "Internal error: provider observation path is not initialized",
    );
  }
  const startedAt = Date.now();
  let lastFailure = "provider observation file does not exist";
  while (Date.now() - startedAt < PROVIDER_READY_TIMEOUT_MS) {
    throwIfInterrupted(state);
    try {
      const observations = await readProviderObservations(state);
      if (observations.requestCount !== 0) {
        throw new Error(
          "Provider must start with an empty observation document",
        );
      }
      return;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(
    `Deterministic provider did not initialize its observation file within ${PROVIDER_READY_TIMEOUT_MS}ms: ${lastFailure}`,
  );
};

const runProviderProtocolSmoke = async (state: RuntimeState): Promise<void> => {
  if (!state.providerContainerId) {
    throw new Error("Internal error: provider container is not initialized");
  }
  const { stdout } = await runCommand(
    "docker",
    [
      "exec",
      state.providerContainerId,
      "python3",
      "/usr/local/libexec/lotus-real-bamboo-provider.py",
      "--smoke",
    ],
    { timeoutMs: PROVIDER_READY_TIMEOUT_MS },
  );
  if (stdout.trim() !== "deterministic provider smoke passed") {
    throw new Error(
      `Provider protocol smoke returned an unexpected result: ${stdout.trim() || "<empty>"}`,
    );
  }

  const observations = await readProviderObservations(state);
  const [request, rejectionRequest] = observations.requests;
  if (
    observations.requestCount !== 2 ||
    !request ||
    request.model !== REAL_BAMBOO_MODEL ||
    request.stream !== true ||
    request.userMarkerPresent !== false ||
    request.smokeMarkerPresent !== true ||
    !rejectionRequest ||
    rejectionRequest.model !== null ||
    rejectionRequest.stream !== true ||
    rejectionRequest.userMarkerPresent !== false ||
    rejectionRequest.smokeMarkerPresent !== true
  ) {
    throw new Error(
      "Provider protocol smoke did not produce the exact success and redacted-rejection observations",
    );
  }
};

const startBambooContainer = async (state: RuntimeState): Promise<string> => {
  if (
    !state.runtimeDataRoot ||
    !state.runtimeImage ||
    !state.containerName ||
    !state.containerUser ||
    !state.networkName
  ) {
    throw new Error(
      "Internal error: Bamboo container resources must be recorded before Docker run",
    );
  }

  state.containerCreateAttempted = true;
  const { stdout } = await runCommand("docker", [
    "run",
    "--detach",
    "--name",
    state.containerName,
    "--label",
    `lotus.real-bamboo.run=${state.runId}`,
    "--network",
    state.networkName,
    "--publish",
    `127.0.0.1::${BAMBOO_CONTAINER_PORT}`,
    "--mount",
    `type=bind,source=${state.runtimeDataRoot},target=/data`,
    "--mount",
    `type=bind,source=${DIST_ROOT},target=/frontend,readonly`,
    "--env",
    "HOME=/data",
    "--env",
    "BAMBOO_DATA_DIR=/data/bamboo",
    "--env",
    "BAMBOO_WORKSPACE_ROOT=/data/bamboo/workspaces",
    // The container must bind 0.0.0.0 so Docker can publish it, but the host
    // publication above is loopback-only. Match Bamboo's native loopback
    // posture: the production frontend legitimately bursts API and asset
    // requests during startup and native loopback binds skip this limiter.
    "--env",
    "BAMBOO_RATE_LIMIT_PER_SECOND=1000",
    "--env",
    "BAMBOO_RATE_LIMIT_BURST=1000",
    "--user",
    state.containerUser,
    state.runtimeImage,
    "serve",
    "--port",
    String(BAMBOO_CONTAINER_PORT),
    "--bind",
    "0.0.0.0",
    "--workers",
    "1",
    "--data-dir",
    "/data/bamboo",
    "--static-dir",
    "/frontend",
  ]);
  const containerId = stdout.trim();
  if (!/^[0-9a-f]{12,64}$/u.test(containerId)) {
    throw new Error(
      `Docker returned an invalid container id: ${containerId || "<empty>"}`,
    );
  }
  state.containerId = containerId;

  const hostPort = await publishedBambooPort(containerId);
  return `http://127.0.0.1:${hostPort}`;
};

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const responseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const requestJson = async (
  url: string,
  init?: Parameters<typeof fetch>[1],
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: await responseBody(response) };
};

const containerLogTail = async (state: RuntimeState): Promise<string> => {
  const containerTarget = state.containerId ?? state.containerName;
  if (!state.containerCreateAttempted || !containerTarget) return "";
  try {
    const result = await runCommand(
      "docker",
      ["logs", "--tail", "120", containerTarget],
      { timeoutMs: CLEANUP_COMMAND_TIMEOUT_MS },
    );
    return truncateTail(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
      16_000,
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const safeContainerLogEvidence = async (
  state: RuntimeState,
): Promise<string> => {
  const logs = redact(await containerLogTail(state), [
    state.fakeApiKey,
    state.userMarker,
    state.assistantMarker,
    state.smokeMarker,
  ]);
  return sanitizeBambooLogEvidence(logs);
};

const sanitizeBambooLogEvidence = (logs: string): string => {
  if (!logs) return "Bamboo emitted no stdout/stderr lines.";

  return logs
    .split(/\r?\n/u)
    .map((line) =>
      /authorization|bearer|api[_ -]?key|request body|\bmessages?\b|\bprompt\b/iu.test(
        line,
      )
        ? "[REDACTED SENSITIVE LOG LINE]"
        : line,
    )
    .join("\n");
};

const waitForReadiness = async (
  state: RuntimeState,
): Promise<{
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly response: unknown;
}> => {
  if (!state.baseUrl)
    throw new Error("Internal error: Bamboo base URL is not initialized");
  const startedAt = Date.now();
  let attempts = 0;
  let lastFailure = "Bamboo did not answer";

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    throwIfInterrupted(state);
    attempts += 1;
    try {
      const result = await requestJson(`${state.baseUrl}/readyz`);
      if (
        result.status === 200 &&
        isJsonObject(result.body) &&
        result.body.status === "ok" &&
        typeof result.body.version === "string"
      ) {
        return {
          attempts,
          elapsedMs: Date.now() - startedAt,
          response: result.body,
        };
      }
      lastFailure = `status ${result.status}: ${truncateTail(JSON.stringify(result.body), 1_000)}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }

  const logs = redact(await containerLogTail(state), [
    state.fakeApiKey,
    state.userMarker,
    state.assistantMarker,
    state.smokeMarker,
  ]);
  throw new Error(
    `Bamboo did not become ready at /readyz within ${READY_TIMEOUT_MS}ms. Last probe: ${lastFailure}${logs ? `\nContainer log tail:\n${logs}` : ""}`,
  );
};

const validateBootstrap = (bootstrap: unknown): void => {
  if (!isJsonObject(bootstrap) || bootstrap.schema_version !== 1) {
    throw new Error("Bamboo bootstrap must have schema_version=1");
  }
  if (
    !isJsonObject(bootstrap.server) ||
    bootstrap.server.product !== "bamboo"
  ) {
    throw new Error("Bamboo bootstrap must identify server.product=bamboo");
  }
  if (
    !isJsonObject(bootstrap.api) ||
    bootstrap.api.canonical_base_path !== "/api/v1"
  ) {
    throw new Error(
      "Bamboo bootstrap must expose api.canonical_base_path=/api/v1",
    );
  }
  if (
    !isJsonObject(bootstrap.realtime) ||
    bootstrap.realtime.path !== "/v2/stream"
  ) {
    throw new Error("Bamboo bootstrap must expose realtime.path=/v2/stream");
  }
  if (
    !Array.isArray(bootstrap.realtime.subprotocols) ||
    !bootstrap.realtime.subprotocols.some(
      (entry) => isJsonObject(entry) && entry.name === "bamboo.v2",
    )
  ) {
    throw new Error(
      "Bamboo bootstrap must advertise the bamboo.v2 WebSocket subprotocol",
    );
  }
  if (
    !Array.isArray(bootstrap.capabilities) ||
    bootstrap.capabilities.filter(
      (capability) => capability === "auth.ws_hello_ack.v1",
    ).length !== 1
  ) {
    throw new Error(
      "Bamboo bootstrap must advertise auth.ws_hello_ack.v1 exactly once",
    );
  }
};

const fetchBootstrap = async (baseUrl: string): Promise<unknown> => {
  const result = await requestJson(`${baseUrl}/api/v1/bootstrap`);
  if (result.status !== 200) {
    throw new Error(`GET /api/v1/bootstrap returned HTTP ${result.status}`);
  }
  validateBootstrap(result.body);
  return result.body;
};

const fetchSetupStatus = async (baseUrl: string): Promise<unknown> => {
  const result = await requestJson(`${baseUrl}/api/v1/bamboo/setup/status`);
  if (
    result.status !== 200 ||
    !isJsonObject(result.body) ||
    result.body.is_complete !== true
  ) {
    throw new Error(
      `GET /api/v1/bamboo/setup/status did not confirm the isolated fixture is complete (HTTP ${result.status})`,
    );
  }
  return result.body;
};

const createProject = async (
  baseUrl: string,
  name: string,
  projectPath: string,
): Promise<string> => {
  const result = await requestJson(`${baseUrl}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, project_path: projectPath }),
  });
  if (
    result.status !== 201 ||
    !isJsonObject(result.body) ||
    typeof result.body.id !== "string" ||
    result.body.id.length === 0 ||
    result.body.name !== name ||
    result.body.project_path !== projectPath
  ) {
    const error = isJsonObject(result.body) ? result.body.error : null;
    const errorCode =
      isJsonObject(error) && typeof error.code === "string"
        ? error.code
        : "unknown";
    throw new Error(
      `POST /api/v1/projects did not persist the isolated ${name} fixture (HTTP ${result.status}, code ${errorCode})`,
    );
  }
  return result.body.id;
};

const createFinalizedSession = async (
  baseUrl: string,
  title: string,
  projectId?: string,
): Promise<string> => {
  const result = await requestJson(`${baseUrl}/api/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(projectId === undefined ? {} : { project_id: projectId }),
      title,
      title_generated: true,
      model: REAL_BAMBOO_MODEL,
      model_ref: { provider: REAL_BAMBOO_PROVIDER, model: REAL_BAMBOO_MODEL },
    }),
  });
  if (
    result.status !== 201 ||
    !isJsonObject(result.body) ||
    !isJsonObject(result.body.session)
  ) {
    throw new Error(
      `POST /api/v1/sessions returned an invalid HTTP ${result.status} response`,
    );
  }

  const session = result.body.session;
  const sessionProjectId = session.project_id ?? undefined;
  if (
    typeof session.id !== "string" ||
    session.id.length === 0 ||
    sessionProjectId !== projectId ||
    session.kind !== "root" ||
    session.root_session_id !== session.id ||
    session.title !== title ||
    session.title_generated !== true ||
    !isJsonObject(session.model_ref) ||
    session.model_ref.provider !== REAL_BAMBOO_PROVIDER ||
    session.model_ref.model !== REAL_BAMBOO_MODEL
  ) {
    throw new Error(
      `POST /api/v1/sessions did not persist the finalized ${title} session contract`,
    );
  }
  return session.id;
};

const restoreEnvironment = (state: RuntimeState): void => {
  for (const key of EXPORTED_ENVIRONMENT_KEYS) {
    const previous = state.environmentBefore.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
};

const isMissingDockerResource = (message: string): boolean =>
  /No such (?:container|image|network)|not found/iu.test(message);

const performCleanupRuntime = async (
  state: RuntimeState,
): Promise<string[]> => {
  const errors: string[] = [];

  const providerTarget =
    state.providerContainerId ?? state.providerContainerName;
  if (state.providerContainerCreateAttempted && providerTarget) {
    try {
      const providerLogs = await runCommand(
        "docker",
        ["logs", "--tail", "120", providerTarget],
        {
          timeoutMs: CLEANUP_COMMAND_TIMEOUT_MS,
        },
      );
      await writeTextEvidence(
        state,
        "provider-log-tail.txt",
        redact(
          truncateTail(
            [providerLogs.stdout, providerLogs.stderr]
              .filter(Boolean)
              .join("\n"),
            16_000,
          ) || "Provider emitted no stdout/stderr lines.",
          [
            state.fakeApiKey,
            state.userMarker,
            state.assistantMarker,
            state.smokeMarker,
          ],
        ),
      );
    } catch (error) {
      await writeTextEvidence(
        state,
        "provider-log-tail.txt",
        redact(error instanceof Error ? error.message : String(error), [
          state.fakeApiKey,
          state.userMarker,
          state.assistantMarker,
          state.smokeMarker,
        ]),
      ).catch(() => undefined);
    }
    const cleanupError = await commandCleanupError("docker", [
      "rm",
      "--force",
      providerTarget,
    ]);
    if (cleanupError && !isMissingDockerResource(cleanupError)) {
      errors.push(
        `remove provider container ${providerTarget.slice(0, 64)}: ${cleanupError}`,
      );
    }
    state.providerContainerId = undefined;
    state.providerContainerName = undefined;
  }

  const containerTarget = state.containerId ?? state.containerName;
  if (state.containerCreateAttempted && containerTarget) {
    try {
      await writeTextEvidence(
        state,
        "bamboo-log-tail.txt",
        await safeContainerLogEvidence(state),
      );
    } catch (error) {
      errors.push(
        `write Bamboo log evidence: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const cleanupError = await commandCleanupError("docker", [
      "rm",
      "--force",
      containerTarget,
    ]);
    if (cleanupError && !isMissingDockerResource(cleanupError)) {
      errors.push(
        `remove container ${containerTarget.slice(0, 64)}: ${cleanupError}`,
      );
    }
    state.containerId = undefined;
    state.containerName = undefined;
  }

  if (
    state.providerContainerCreateAttempted &&
    state.providerObservationsPath
  ) {
    try {
      const observations = sanitizeProviderObservations(
        state,
        JSON.parse(
          await readFile(state.providerObservationsPath, "utf8"),
        ) as unknown,
      );
      await writeEvidence(state, "provider-observations.json", observations);
    } catch (error) {
      await writeEvidence(state, "provider-observations.json", {
        schemaVersion: 1,
        unavailable: true,
        detail: redact(error instanceof Error ? error.message : String(error), [
          state.fakeApiKey,
          state.userMarker,
          state.assistantMarker,
          state.smokeMarker,
        ]),
      }).catch(() => undefined);
    }
  }

  if (state.networkCreateAttempted && state.networkName) {
    const cleanupError = await commandCleanupError("docker", [
      "network",
      "rm",
      state.networkName,
    ]);
    if (cleanupError && !isMissingDockerResource(cleanupError)) {
      errors.push(
        `remove private network ${state.networkName}: ${cleanupError}`,
      );
    }
    state.networkName = undefined;
  }

  if (state.imageBuildAttempted && state.builtImage) {
    const cleanupError = await commandCleanupError("docker", [
      "image",
      "rm",
      state.builtImage,
    ]);
    if (cleanupError && !isMissingDockerResource(cleanupError)) {
      errors.push(`remove harness image ${state.builtImage}: ${cleanupError}`);
    }
    state.builtImage = undefined;
  }

  if (state.tempRootOwned && state.tempRoot) {
    try {
      await rm(state.tempRoot, { recursive: true, force: true });
    } catch (error) {
      errors.push(
        `remove harness temp root: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    state.tempRoot = undefined;
  }

  restoreEnvironment(state);
  return errors.map((error) => redact(error, [state.fakeApiKey]));
};

const cleanupRuntime = (state: RuntimeState): Promise<string[]> => {
  state.cleanupPromise ??= performCleanupRuntime(state);
  return state.cleanupPromise;
};

const revisionEvidence = (state: RuntimeState) => ({
  schemaVersion: 1,
  expectedRevision: REAL_BAMBOO_REVISION,
  mode: "source-build",
  source: state.sourceValidation
    ? {
        head: state.sourceValidation.head,
        headExact: state.sourceValidation.head === REAL_BAMBOO_REVISION,
        clean: state.sourceValidation.clean,
        cleanlinessCommand: "git status --porcelain=v1 --untracked-files=all",
        buildContext:
          "git archive of the verified commit plus one harness-owned provider script",
        bambooSourceArchiveExact: true,
        providerHarnessInjected: true,
      }
    : {
        configured: false,
        buildContext: "not created",
        bambooSourceArchiveExact: null,
        providerHarnessInjected: null,
      },
  image: {
    reference: state.runtimeImage ?? null,
    ociRevision: state.imageRevision ?? null,
    revisionExact: state.imageRevision
      ? state.imageRevision === REAL_BAMBOO_REVISION
      : null,
  },
});

const runtimeSummary = (
  state: RuntimeState,
  status: "ready" | "failed",
  detail?: string,
) => ({
  schemaVersion: 1,
  status,
  stage: state.stage,
  revision: REAL_BAMBOO_REVISION,
  mode: "source-build",
  sourceHeadExact: state.sourceValidation
    ? state.sourceValidation.head === REAL_BAMBOO_REVISION
    : null,
  sourceClean: state.sourceValidation?.clean ?? null,
  imageRevisionExact: state.imageRevision
    ? state.imageRevision === REAL_BAMBOO_REVISION
    : null,
  runtime: {
    containerId: state.containerId?.slice(0, 12) ?? null,
    containerName: state.containerName ?? null,
    providerContainerId: state.providerContainerId?.slice(0, 12) ?? null,
    providerContainerName: state.providerContainerName ?? null,
    privateNetwork: state.networkName ?? null,
    baseUrl: state.baseUrl ?? null,
    sessionId: state.sessionId ?? null,
    memorySessionId: state.memorySessionId ?? null,
    projectId: state.projectId ?? null,
    otherProjectSessionId: state.otherProjectSessionId ?? null,
    otherProjectId: state.otherProjectId ?? null,
    model: REAL_BAMBOO_MODEL,
    provider: REAL_BAMBOO_PROVIDER,
    userMarker: state.userMarker ?? null,
    assistantMarker: state.assistantMarker ?? null,
  },
  isolation: {
    containerUser: state.containerUser ?? null,
    containerRunsAsRoot: state.containerUser?.startsWith("0:") ?? null,
    home: "/data",
    bambooDataDir: "/data/bamboo",
    jianduDataDir: "/data/.jiandu",
    frontendMount: "/frontend:ro",
    dataMountOwnership: "single harness-created temporary root",
    exposure: "Docker port published on 127.0.0.1 only",
    providerTransport: `sibling container sharing Bamboo's network namespace -> 127.0.0.1:${PROVIDER_CONTAINER_PORT}`,
    providerHostTcpExposure:
      "none (provider binds container loopback; only Bamboo port 9562 is published)",
    providerPortBindings: "none (asserted with Docker inspect)",
    providerNetworkMode: "container:<exact Bamboo container id> (asserted)",
    observationsExposure: "harness-owned bind-mounted JSON file",
    dockerNetworkDedicated: true,
    rateLimitPosture:
      "native-loopback-equivalent (1000 requests/second, burst 1000)",
  },
  detail: detail ?? null,
});

const writeFailureEvidence = async (
  state: RuntimeState,
  detail: string,
): Promise<void> => {
  state.failureEvidencePromise ??= (async () => {
    try {
      await writeEvidence(state, "revision.json", revisionEvidence(state));
    } catch {
      // Preserve the primary setup or signal failure if the evidence path is unavailable.
    }
    try {
      await writeEvidence(
        state,
        "runtime-summary.json",
        runtimeSummary(state, "failed", detail),
      );
    } catch {
      // Preserve the primary setup or signal failure if the evidence path is unavailable.
    }
  })();
  await state.failureEvidencePromise;
};

const syncDockerResult = (
  args: readonly string[],
): { readonly ok: boolean; readonly output: string } => {
  const result = spawnSync("docker", [...args], {
    encoding: "utf8",
    maxBuffer: COMMAND_BUFFER_BYTES,
    timeout: CLEANUP_COMMAND_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const output = truncateTail(
    [result.stderr, result.stdout, result.error?.message]
      .filter(Boolean)
      .join("\n"),
    16_000,
  );
  return { ok: result.status === 0 && !result.error, output };
};

const syncDockerCleanupError = (args: readonly string[]): string | null => {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = syncDockerResult(args);
    if (result.ok || isMissingDockerResource(result.output)) return null;
    lastError = result.output || "Docker cleanup returned no diagnostic";
    // Give a concurrently killed docker client a bounded moment to release its
    // daemon operation before retrying the exact same harness-owned resource.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return lastError;
};

const emergencySignalCleanup = (
  state: RuntimeState,
  signal: NodeJS.Signals,
): string[] => {
  const errors: string[] = [];
  const secrets = [
    state.fakeApiKey,
    state.userMarker,
    state.assistantMarker,
    state.smokeMarker,
  ];

  try {
    writeEvidenceSync(state, "revision.json", revisionEvidence(state));
    writeEvidenceSync(
      state,
      "runtime-summary.json",
      runtimeSummary(state, "failed", `Harness interrupted by ${signal}`),
    );
  } catch (error) {
    errors.push(
      `write signal evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const child of activeChildCommands) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Exact Docker cleanup and final label verification below remain authoritative.
    }
  }

  const providerTarget =
    state.providerContainerId ??
    state.providerContainerName ??
    `lotus-real-provider-e2e-${state.runId}`;
  if (state.providerContainerCreateAttempted) {
    const logs = syncDockerResult(["logs", "--tail", "120", providerTarget]);
    if (logs.ok) {
      try {
        writeTextEvidenceSync(
          state,
          "provider-log-tail.txt",
          redact(
            logs.output || "Provider emitted no stdout/stderr lines.",
            secrets,
          ),
        );
      } catch (error) {
        errors.push(
          `write provider log evidence: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const cleanupError = syncDockerCleanupError([
      "rm",
      "--force",
      providerTarget,
    ]);
    if (cleanupError) {
      errors.push(`remove provider container: ${cleanupError}`);
    }
  }

  const containerTarget =
    state.containerId ??
    state.containerName ??
    `lotus-real-bamboo-e2e-${state.runId}`;
  if (state.containerCreateAttempted) {
    const logs = syncDockerResult(["logs", "--tail", "120", containerTarget]);
    if (logs.ok) {
      try {
        writeTextEvidenceSync(
          state,
          "bamboo-log-tail.txt",
          sanitizeBambooLogEvidence(redact(logs.output, secrets)),
        );
      } catch (error) {
        errors.push(
          `write Bamboo log evidence: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const cleanupError = syncDockerCleanupError([
      "rm",
      "--force",
      containerTarget,
    ]);
    if (cleanupError) errors.push(`remove Bamboo container: ${cleanupError}`);
  }

  if (state.providerObservationsPath) {
    try {
      const observations = sanitizeProviderObservations(
        state,
        JSON.parse(
          readFileSync(state.providerObservationsPath, "utf8"),
        ) as unknown,
      );
      writeEvidenceSync(state, "provider-observations.json", observations);
    } catch (error) {
      errors.push(
        `preserve provider observations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (state.networkCreateAttempted) {
    const networkName =
      state.networkName ?? `lotus-real-bamboo-net-${state.runId}`;
    const cleanupError = syncDockerCleanupError(["network", "rm", networkName]);
    if (cleanupError) errors.push(`remove private network: ${cleanupError}`);
  }

  if (state.imageBuildAttempted) {
    const image = state.builtImage ?? `lotus-real-bamboo-e2e:${state.runId}`;
    const cleanupError = syncDockerCleanupError(["image", "rm", image]);
    if (cleanupError) errors.push(`remove harness image: ${cleanupError}`);
  }

  if (state.tempRootOwned && state.tempRoot) {
    try {
      rmSync(state.tempRoot, { recursive: true, force: true });
    } catch (error) {
      errors.push(
        `remove harness temp root: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  restoreEnvironment(state);
  return errors.map((error) => redact(error, secrets));
};

const suspendExternalSigintListeners = (state: RuntimeState): void => {
  if (state.suspendedSigintListeners !== undefined) {
    throw new Error(
      "Internal error: external SIGINT listeners are already suspended",
    );
  }
  const harnessHandler = state.signalHandlers?.get("SIGINT");
  const externalListeners = process
    .rawListeners("SIGINT")
    .filter(
      (listener) => listener !== harnessHandler,
    ) as NodeJS.SignalsListener[];
  for (const listener of externalListeners) {
    process.off("SIGINT", listener);
  }
  state.suspendedSigintListeners = externalListeners;
};

const restoreExternalSigintListeners = (state: RuntimeState): void => {
  if (state.suspendedSigintListeners === undefined) return;
  for (const listener of state.suspendedSigintListeners) {
    process.on("SIGINT", listener);
  }
  state.suspendedSigintListeners = undefined;
};

const removeSignalHandlers = (state: RuntimeState): void => {
  if (state.signalHandlers) {
    for (const [signal, handler] of state.signalHandlers) {
      process.off(signal, handler);
    }
  }
  restoreExternalSigintListeners(state);
  state.signalHandlers = undefined;
};

const exitWithSignalCode = (signal: NodeJS.Signals): never =>
  process.exit(signal === "SIGINT" ? 130 : 143);

const registerSignalHandlers = (state: RuntimeState): void => {
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (state.interruptedSignal) return;
    state.interruptedSignal = signal;
    state.stage = `interrupted by ${signal}`;

    if (state.runtimeReadyForTests && !state.cleanupPromise) {
      const cleanupErrors = emergencySignalCleanup(state, signal);
      if (cleanupErrors.length > 0) {
        try {
          writeEvidenceSync(state, "cleanup-errors.json", {
            schemaVersion: 1,
            signal,
            errors: cleanupErrors,
          });
        } catch {
          // Cleanup remains authoritative even if the evidence filesystem fails.
        }
      }
      removeSignalHandlers(state);
      exitWithSignalCode(signal);
    }

    // Once normal teardown has started, its caller has already suspended
    // Playwright's competing SIGINT watcher. Reuse that in-flight cleanup
    // instead of killing its active Docker command and racing the daemon with
    // a second, synchronous removal sequence.
    state.signalCleanupPromise = (async () => {
      if (!state.cleanupPromise) await terminateActiveChildCommands();
      await writeFailureEvidence(state, `Harness interrupted by ${signal}`);
      const cleanupErrors = await cleanupRuntime(state);
      if (cleanupErrors.length > 0) {
        await writeEvidence(state, "cleanup-errors.json", {
          schemaVersion: 1,
          signal,
          errors: cleanupErrors,
        }).catch(() => undefined);
      }
      removeSignalHandlers(state);
      exitWithSignalCode(signal);
    })().catch(() => {
      removeSignalHandlers(state);
      exitWithSignalCode(signal);
    });
  };

  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = (): void => handleSignal(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  state.signalHandlers = handlers;
  suspendExternalSigintListeners(state);
};

const globalSetup = async (): Promise<() => Promise<void>> => {
  const runId = randomUUID().replaceAll("-", "");
  const containerIdentity = nonRootContainerIdentity();
  const tempRoot = path.join(tmpdir(), `lrb-${runId.slice(0, 12)}`);
  const runtimeDataRoot = path.join(tempRoot, "runtime-data");
  const providerObservationsDirectory = path.join(
    tempRoot,
    "provider-observations",
  );
  const providerObservationsPath = path.join(
    providerObservationsDirectory,
    PROVIDER_OBSERVATIONS_FILENAME,
  );
  const state: RuntimeState = {
    stage: "initializing",
    runId,
    evidenceRoot: path.join(EVIDENCE_BASE, runId),
    tempRoot,
    tempRootOwned: false,
    runtimeDataRoot,
    containerName: `lotus-real-bamboo-e2e-${runId}`,
    containerCreateAttempted: false,
    providerContainerName: `lotus-real-provider-e2e-${runId}`,
    providerContainerCreateAttempted: false,
    networkName: `lotus-real-bamboo-net-${runId}`,
    networkCreateAttempted: false,
    providerObservationsDirectory,
    providerObservationsPath,
    builtImage: `lotus-real-bamboo-e2e:${runId}`,
    imageBuildAttempted: false,
    runtimeImage: `lotus-real-bamboo-e2e:${runId}`,
    containerUser: containerIdentity.user,
    containerUid: containerIdentity.uid,
    containerGid: containerIdentity.gid,
    requiresHostChown: containerIdentity.requiresHostChown,
    runtimeReadyForTests: false,
    environmentBefore: new Map(
      EXPORTED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const),
    ),
  };
  registerSignalHandlers(state);

  try {
    await mkdir(state.evidenceRoot, { recursive: true, mode: 0o700 });
    await chmod(state.evidenceRoot, 0o700);
    advanceStage(state, "validating production artifact");
    await ensureProductionArtifact();

    advanceStage(state, "validating Docker");
    state.dockerServerVersion = await ensureDocker();

    const configuredSource = process.env.BAMBOO_E2E_SOURCE_DIR?.trim();
    const configuredImage = process.env.BAMBOO_E2E_IMAGE?.trim();
    if (configuredImage) {
      throw new Error(
        "BAMBOO_E2E_IMAGE is not supported: real Bamboo E2E must build the verified source so Bamboo and the private provider sibling share one harness-owned runtime image.",
      );
    }
    if (!configuredSource) {
      throw new Error(
        `Set BAMBOO_E2E_SOURCE_DIR to a completely clean checkout at ${REAL_BAMBOO_REVISION}. The harness does not clone, pull, or accept a prebuilt image.`,
      );
    }

    advanceStage(state, "validating Bamboo source");
    state.sourceValidation = await validateSourceDirectory(configuredSource);

    advanceStage(state, "creating isolated runtime root");
    mkdirSync(tempRoot, { mode: 0o700 });
    state.tempRootOwned = true;
    chmodSync(tempRoot, 0o700);
    mkdirSync(runtimeDataRoot, { mode: 0o700 });
    chmodSync(runtimeDataRoot, 0o700);
    mkdirSync(providerObservationsDirectory, { mode: 0o700 });
    chmodSync(providerObservationsDirectory, 0o700);
    await applyContainerOwnership(state, tempRoot);
    await applyContainerOwnership(state, runtimeDataRoot);
    await applyContainerOwnership(state, providerObservationsDirectory);

    advanceStage(state, "building pinned Bamboo image");
    await writeEvidence(state, "revision.json", revisionEvidence(state));
    await buildPinnedBambooImage(state, state.sourceValidation);
    await writeEvidence(state, "revision.json", revisionEvidence(state));

    state.fakeApiKey = `sk-lotus-real-bamboo-${randomUUID()}`;
    state.userMarker = `lotus-real-user-${randomUUID()}`;
    state.assistantMarker = `lotus-real-assistant-${randomUUID()}`;
    state.smokeMarker = `lotus-real-smoke-${randomUUID()}`;

    advanceStage(state, "writing isolated Bamboo configuration");
    await writeBambooConfig(state);

    advanceStage(state, "creating isolated Project workspaces");
    await prepareProjectWorkspaces(state);

    advanceStage(state, "creating private Docker network");
    await createPrivateNetwork(state);

    advanceStage(state, "starting Bamboo container");
    state.baseUrl = await startBambooContainer(state);

    advanceStage(state, "starting loopback provider sidecar");
    await startProviderContainer(state);

    advanceStage(state, "waiting for loopback provider readiness");
    await waitForProviderReadiness(state);

    advanceStage(state, "verifying provider protocol");
    await runProviderProtocolSmoke(state);

    advanceStage(state, "waiting for Bamboo readiness");
    const readiness = await waitForReadiness(state);
    await writeEvidence(state, "readiness.json", {
      schemaVersion: 1,
      path: "/readyz",
      ...readiness,
    });

    advanceStage(state, "verifying Bamboo bootstrap");
    const bootstrap = await fetchBootstrap(state.baseUrl);
    await writeEvidence(state, "bootstrap.json", bootstrap);

    advanceStage(state, "verifying isolated setup state");
    const setupStatus = await fetchSetupStatus(state.baseUrl);
    await writeEvidence(state, "setup-status.json", setupStatus);

    advanceStage(state, "creating isolated Bamboo Projects");
    state.projectId = await createProject(
      state.baseUrl,
      "Lotus real Bamboo E2E",
      PRIMARY_PROJECT_CONTAINER_PATH,
    );
    state.otherProjectId = await createProject(
      state.baseUrl,
      "Lotus other Project E2E",
      SECONDARY_PROJECT_CONTAINER_PATH,
    );

    advanceStage(state, "creating Project-bound Bamboo memory sessions");
    state.memorySessionId = await createFinalizedSession(
      state.baseUrl,
      "Lotus primary memory Project E2E",
      state.projectId,
    );
    state.otherProjectSessionId = await createFinalizedSession(
      state.baseUrl,
      "Lotus other Project E2E",
      state.otherProjectId,
    );

    advanceStage(state, "creating unassigned Bamboo chat session");
    state.sessionId = await createFinalizedSession(
      state.baseUrl,
      "Lotus real Bamboo E2E",
    );

    advanceStage(state, "ready");
    await writeEvidence(state, "runtime-summary.json", {
      ...runtimeSummary(state, "ready"),
      dockerServerVersion: state.dockerServerVersion,
      providerObservationsPath: state.providerObservationsPath,
    });

    process.env.LOTUS_REAL_BAMBOO_BASE_URL = state.baseUrl;
    process.env.LOTUS_REAL_BAMBOO_SESSION_ID = state.sessionId;
    process.env.LOTUS_REAL_BAMBOO_MEMORY_SESSION_ID = state.memorySessionId;
    process.env.LOTUS_REAL_BAMBOO_OTHER_PROJECT_SESSION_ID =
      state.otherProjectSessionId;
    process.env.LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH =
      state.providerObservationsPath;
    process.env.LOTUS_REAL_USER_MARKER = state.userMarker;
    process.env.LOTUS_REAL_ASSISTANT_MARKER = state.assistantMarker;
    process.env.LOTUS_REAL_BAMBOO_REVISION = REAL_BAMBOO_REVISION;
    throwIfInterrupted(state);
    state.runtimeReadyForTests = true;
    // Restore Playwright's normal test watcher, while the earlier-registered
    // harness listener remains the synchronous cleanup barrier for any signal.
    restoreExternalSigintListeners(state);

    return async () => {
      let cleanupErrors: string[];
      // Playwright installs a fresh SIGINT watcher for its teardown TaskRunner.
      // Suspend that watcher only while our single-flight cleanup is pending so
      // it cannot win TaskRunner's Promise.race and force-exit mid-cleanup.
      suspendExternalSigintListeners(state);
      try {
        cleanupErrors = await cleanupRuntime(state);
        // A signal may arrive while the single-flight teardown is pending. In
        // that case, keep Playwright's teardown task alive until the signal
        // path records evidence and exits with the conventional signal code.
        // Removing our handler or returning first could let the runner report
        // a successful exit even though the process was interrupted.
        if (state.signalCleanupPromise) await state.signalCleanupPromise;
      } finally {
        if (!state.signalCleanupPromise) removeSignalHandlers(state);
      }
      if (cleanupErrors.length > 0) {
        throw new Error(
          `Real Bamboo teardown was incomplete:\n${cleanupErrors.join("\n")}`,
        );
      }
    };
  } catch (error) {
    const detail = redact(
      error instanceof Error ? error.message : String(error),
      [state.fakeApiKey],
    );
    if (state.signalCleanupPromise) {
      await state.signalCleanupPromise;
      throw new Error(detail);
    }
    await writeFailureEvidence(state, detail);
    const cleanupErrors = await cleanupRuntime(state);
    removeSignalHandlers(state);
    throw new Error(
      cleanupErrors.length > 0
        ? `${detail}\nCleanup errors:\n${cleanupErrors.join("\n")}`
        : detail,
    );
  }
};

export default globalSetup;
