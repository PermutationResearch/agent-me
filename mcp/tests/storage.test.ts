import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// A data folder on an unmounted volume cannot be created. The server must still start,
// report the problem and fail only the tools that write local records.
test("MCP server starts and reports unavailable storage instead of exiting", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-me-storage-"));
  const source = join(root, "fixture.jsonl");
  await writeFile(source, JSON.stringify({ source: "fixture", conversation_id: "conv", events: [{ role: "user", text: "Fictional task: verify the release." }] }));
  await chmod(root, 0o500);
  const client = new Client({ name: "agent-me-storage-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/server.js"], cwd: process.cwd(), stderr: "pipe", env: { ...process.env as Record<string, string>, AGENT_ME_MCP_DATA_DIR: join(root, "Unmounted Vault", "state") } });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  try {
    await client.connect(transport);
    const status = await client.callTool({ name: "get_agent_me_status", arguments: {} });
    assert.notEqual(status.isError, true, JSON.stringify(status.content));
    assert.equal((status.structuredContent as Record<string, any>).storage_available, false);
    const extraction = await client.callTool({ name: "extract_traces", arguments: { paths: [source] } });
    assert.equal(extraction.isError, true);
    assert.match(JSON.stringify(extraction.content), /AGENT_ME_MCP_DATA_DIR/);
    assert.match(stderr, /AGENT_ME_MCP_DATA_DIR/, "Startup must explain the storage problem in the host's MCP log.");
  } finally {
    await client.close();
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});
