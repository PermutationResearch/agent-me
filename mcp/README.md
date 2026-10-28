# Agent-Me MCP

Local stdio server for extraction, review, selected exports, experimental valuation, real GEPA optimization and confirmed submission.

```sh
npm ci
npm run build
node /absolute/path/to/agent-me/mcp/dist/server.js
```

The last command is launched by your MCP client; it waits for protocol messages on stdin. See [the setup and workflow](../docs/MCP.md), [pricing research](../docs/TRACE_PRICING.md), or open `/mcp` in the local website. Node22+ required; Python GEPA/Ollama are optional for extraction but required for optimization. No public hosting or global client configuration is changed.
