import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const inspectFormat = '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"networkMode":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}';

interface ContainerInspection {
  id: string;
  labels: Record<string, string>;
  running: boolean;
  startedAt: string;
  networkMode: string;
  ports: Record<string, { HostIp: string; HostPort: string }[] | null> | null;
}

async function docker(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("docker", args, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    });
    return stdout.trim();
  } catch {
    // Never include Docker output, environment or imported credential values.
    throw new Error(`Owned real-Bamboo container ${args[0]} failed`);
  }
}

async function inspect(id: string, runId: string): Promise<ContainerInspection> {
  const value = JSON.parse(await docker(["inspect", "--format", inspectFormat, id])) as ContainerInspection;
  assert.equal(value.id, id, "The exact harness-owned container must match");
  assert.equal(value.labels?.["lotus.real-bamboo.run"], runId, "The current run must own the container");
  assert.equal(value.running, true, "The owned container must be running");
  assert.ok(Number.isFinite(Date.parse(value.startedAt)), "The start timestamp must be valid");
  return value;
}

function baseUrl(container: ContainerInspection): URL {
  const bindings = container.ports?.["9562/tcp"];
  assert.ok(Array.isArray(bindings) && bindings.length === 1, "One explicit Bamboo port is required");
  const binding = bindings[0]!;
  assert.equal(binding.HostIp, "127.0.0.1", "Bamboo must remain loopback-only");
  assert.match(binding.HostPort, /^\d+$/);
  const port = Number(binding.HostPort);
  assert.ok(port > 0 && port <= 65_535);
  return new URL(`http://127.0.0.1:${port}`);
}

/** Restart only this lane's already-recorded disposable containers. */
export async function restartRealBamboo(expectedOrigin: string): Promise<{
  baseUrl: URL;
  startedBefore: string;
  startedAfter: string;
}> {
  const bambooId = process.env.LOTUS_REAL_BAMBOO_CONTAINER_ID ?? "";
  const providerId = process.env.LOTUS_REAL_PROVIDER_CONTAINER_ID ?? "";
  const runId = process.env.LOTUS_REAL_BAMBOO_RUN_ID ?? "";
  assert.match(bambooId, /^[a-f0-9]{64}$/);
  assert.match(providerId, /^[a-f0-9]{64}$/);
  assert.notEqual(bambooId, providerId);
  assert.match(runId, /^[a-f0-9]{32}$/);
  const [before, provider] = await Promise.all([inspect(bambooId, runId), inspect(providerId, runId)]);
  assert.equal(baseUrl(before).origin, expectedOrigin, "Only the current test origin may restart");
  assert.equal(provider.networkMode, `container:${bambooId}`);
  assert.deepEqual(provider.ports ?? {}, {}, "The private provider must publish no ports");

  await docker(["stop", "--time", "5", providerId]);
  await docker(["restart", "--time", "5", bambooId]);
  await docker(["start", providerId]);

  const [after, providerAfter] = await Promise.all([inspect(bambooId, runId), inspect(providerId, runId)]);
  assert.notEqual(after.startedAt, before.startedAt, "A real process restart must occur");
  assert.equal(providerAfter.networkMode, `container:${bambooId}`);
  assert.deepEqual(providerAfter.ports ?? {}, {});
  // Docker may assign a different ephemeral host port after a restart.
  return { baseUrl: baseUrl(after), startedBefore: before.startedAt, startedAfter: after.startedAt };
}
