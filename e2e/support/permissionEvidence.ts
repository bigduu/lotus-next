type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : null;

export function hasExecutedPermissionCommand(
  history: unknown,
  expected: { toolCallId: string; command: string; marker: string },
): boolean {
  if (!Array.isArray(history)) return false;
  const messages = history.map(record);
  const calls = messages.flatMap((message, index) =>
    message?.role === "assistant" && Array.isArray(message.tool_calls)
      ? message.tool_calls.map(record)
        .filter((call) => call?.id === expected.toolCallId)
        .map((call) => ({ call, index })) : []);
  const results = messages.flatMap((message, index) =>
    message?.role === "tool" && message.tool_call_id === expected.toolCallId
      ? [{ message, index }] : []);
  if (calls.length !== 1 || results.length !== 1 || calls[0]!.index >= results[0]!.index)
    return false;
  const fn = record(calls[0]!.call?.function);
  const result = results[0]!.message;
  if (fn?.name !== "exec_command" || typeof fn.arguments !== "string"
      || result.tool_success !== true || typeof result.content !== "string") return false;
  try {
    const args = record(JSON.parse(fn.arguments) as unknown);
    const payload = record(JSON.parse(result.content) as unknown);
    // Bind the result to the exact offered call. A permission placeholder can
    // contain the command and marker without having executed anything.
    return args?.cmd === expected.command && args.yield_time_ms === 10000
      && Object.keys(args).sort().join(",") === "cmd,yield_time_ms"
      && payload?.status === "completed" && payload.exit_code === 0
      && typeof payload.output === "string" && payload.output.trim() === expected.marker
      && payload.session_id === undefined && payload.error === undefined
      && (payload.output_omitted_bytes === undefined || payload.output_omitted_bytes === 0);
  } catch { return false; }
}
