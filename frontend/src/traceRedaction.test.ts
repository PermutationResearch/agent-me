import { describe, expect, it } from "vitest";
import { redactTraceText } from "./traceRedaction";

describe("browser trace redaction", () => {
  it("redacts credential values, bearer keys, owner paths and email before review", () => {
    const input = 'API_KEY="secret-value" Bearer abcdefghijklmnopqrstuvwxyz /Users/alice/project /home/bob/repo C:\\Users\\person\\work alice@example.com';
    const result = redactTraceText(input);
    expect(result.text).not.toContain("secret-value");
    expect(result.text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.text).not.toMatch(/alice|bob|person/);
    expect(result.text).toContain("$HOME");
    expect(result.redactions).toBeGreaterThanOrEqual(6);
  });

  it("redacts nested credential JSON and whole private keys while keeping useful tool content", () => {
    const result = redactTraceText(JSON.stringify({ settings: { password: { actual: "sensitive" } }, max_tokens: 4096, command: "npm test" }));
    expect(result.text).not.toContain("sensitive");
    expect(result.text).toContain("npm test");
    expect(result.text).toContain("4096");
    const key = redactTraceText("before -----BEGIN OPENSSH PRIVATE KEY-----\nsecretbytes\n-----END OPENSSH PRIVATE KEY----- after");
    expect(key.text).toBe("before [redacted:private_key] after");
  });

  it("omits inline media data without clipping ordinary long text", () => {
    const useful = "observable tool result ".repeat(1000);
    const result = redactTraceText(useful + "data:image/png;base64,QUJDREVGR0g=\nend");
    expect(result.text).toContain(useful);
    expect(result.text).toContain("[attachment omitted]");
    expect(result.text).not.toContain("QUJDREVGR0g=");
    expect(result.text).toContain("end");
  });

  it("is idempotent and does not redact ordinary token counts", () => {
    const once = redactTraceText('token_count=12345 max_tokens=4096 password=short');
    expect(once.text).toContain("token_count=12345 max_tokens=4096");
    expect(once.text).not.toContain("short");
    expect(redactTraceText(once.text)).toEqual({ text: once.text, redactions: 0 });
  });
});

it("keeps long uninterrupted tool text responsive and unchanged", () => {
  const plain = "x".repeat(200000);
  const start = performance.now();
  expect(redactTraceText(plain)).toEqual({ text: plain, redactions: 0 });
  expect(performance.now() - start).toBeLessThan(1000);
});

it("omits typed multimodal bytes nested inside normalized JSON payloads", () => {
  const value = [{ type: "image", source: { type: "base64", data: "BINARY-SECRET" } }, { type: "text", text: "keep me" }];
  const redacted = redactTraceText(JSON.stringify(value));
  expect(redacted.text).not.toContain("BINARY-SECRET");
  expect(redacted.text).toContain("keep me");
});
