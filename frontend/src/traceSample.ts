/** Fictional examples bundled locally; this content is never fetched. */
export const TRACE_SAMPLE_JSONL = [
  { type: "session_meta", payload: { id: "fictional-trace-example", source: "cli" } },
  { type: "event_msg", payload: { type: "user_message", message: "Fictional example: verify the release in /Users/example/project before reporting success." } },
  { type: "response_item", payload: { type: "function_call", name: "shell", arguments: "npm test" } },
  { type: "response_item", payload: { type: "function_call_output", output: "Fictional fixture output: 2 tests passed. This sample is not evidence about a real project." } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Example only: report the observed test result and say that deployment was not checked." }] } },
].map(row => JSON.stringify(row)).join("\n");
