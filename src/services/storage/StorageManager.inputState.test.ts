import { beforeEach, describe, expect, it, vi } from "vitest";

const persisted = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  let writes = Promise.resolve();
  const inputStates = {
    get: vi.fn(async (id: string) => {
      await Promise.resolve();
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    }),
    put: vi.fn(async (row: Record<string, unknown>) => {
      await Promise.resolve();
      rows.set(row.sessionId as string, { ...row });
    }),
  };
  return { rows, inputStates,
    // Dexie's rw transactions serialize mutations of this table. Individual
    // get/put deliberately yield so an unprotected overlapping update loses fields.
    transaction: vi.fn((_mode: string, _table: unknown, update: () => Promise<void>) => {
      const result = writes.then(update);
      writes = result.catch(() => {});
      return result;
    }),
  };
});
vi.mock("./StorageDb", () => ({ storageDb: persisted }));
import { StorageManager } from "./StorageManager";

beforeEach(() => { persisted.rows.clear(); localStorage.clear(); vi.clearAllMocks(); });

describe("input fields in the existing storage row", () => {
  it.each([false, true])("preserves simultaneous ordinary/mode saves through reload, mode first %s", async (modeFirst) => {
    const storage = new StorageManager();
    const saveMode = () => storage.saveInputThinkingMode("draft", "ultra");
    const saveReasoning = () => storage.saveInputReasoning("draft", "max");
    await Promise.all(modeFirst ? [saveMode(), saveReasoning()] : [saveReasoning(), saveMode()]);

    const reloaded = new StorageManager();
    expect(await reloaded.loadInputThinkingMode("draft")).toBe("ultra");
    expect(await reloaded.loadInputReasoning("draft")).toBe("max");
    expect(persisted.transaction).toHaveBeenCalledTimes(2);
    expect(persisted.transaction).toHaveBeenCalledWith("rw", persisted.inputStates, expect.any(Function));
  });

  it("clears mode without erasing concurrently saved ordinary effort", async () => {
    const storage = new StorageManager();
    await storage.saveInputThinkingMode("draft", "ultra");
    await Promise.all([storage.saveInputThinkingMode("draft", null), storage.saveInputReasoning("draft", "high")]);
    const reloaded = new StorageManager();
    expect(await reloaded.loadInputThinkingMode("draft")).toBeNull();
    expect(await reloaded.loadInputReasoning("draft")).toBe("high");
  });

  it("clears ordinary effort without erasing concurrently saved mode", async () => {
    const storage = new StorageManager();
    await storage.saveInputReasoning("draft", "max");
    await Promise.all([storage.saveInputReasoning("draft", null), storage.saveInputThinkingMode("draft", "ultra")]);
    const reloaded = new StorageManager();
    expect(await reloaded.loadInputReasoning("draft")).toBeNull();
    expect(await reloaded.loadInputThinkingMode("draft")).toBe("ultra");
  });

  it("preserves pane isolation and rejects malformed mode storage", async () => {
    const storage = new StorageManager();
    await Promise.all([storage.saveInputThinkingMode("", "ultra"), storage.saveInputThinkingMode("__new_chat_pane2__", "standard")]);
    const reloaded = new StorageManager();
    expect(await reloaded.loadInputThinkingMode("")).toBe("ultra");
    expect(await reloaded.loadInputThinkingMode("__new_chat_pane2__")).toBe("standard");
    persisted.rows.set("bad", { thinkingMode: "max" });
    expect(await reloaded.loadInputThinkingMode("bad")).toBeNull();
    await expect(storage.saveInputThinkingMode("bad", "max" as never)).rejects.toThrow("Invalid draft thinking mode");
  });
});
