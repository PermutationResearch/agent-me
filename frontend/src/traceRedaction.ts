/** Best-effort credential/media redaction before a trace enters review state. */
const sensitive = new Set([
  "accesstoken", "apikey", "authorization", "bearertoken", "clientsecret", "cookie",
  "credential", "databasepassword", "idtoken", "oauthtoken", "password", "passwordhash",
  "passwd", "privatekey", "refreshtoken", "secret", "secretaccesskey", "sessionkey",
  "signingsecret", "webhooksecret",
]);
const marker = /^\[redacted(?::[a-z_]+)?\]$/i;

function sensitiveKey(key: string) {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sensitive.has(compact) || /(?:accesstoken|refreshtoken|bearertoken|clientsecret|privatekey|secretkey)$/.test(compact) || compact.startsWith("authorization");
}

export function redactTraceText(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let output = text;
  function scrub(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      const mediaType = String(object.media_type ?? object.mimeType ?? object.mime_type ?? "");
      if (/^(?:image|input_image|image_url|audio|input_audio|output_audio|video)$/.test(String(object.type)) || (object.type === "base64" && /^(?:image|audio|video)\//.test(mediaType))) {
        redactions += 1;
        return "[attachment omitted]";
      }
      return Object.fromEntries(Object.entries(object).map(([key, child]) => {
        if (sensitiveKey(key) && child !== null && child !== "" && !(typeof child === "string" && marker.test(child))) {
          redactions += 1;
          return [key, "[redacted]"];
        }
        return [key, scrub(child)];
      }));
    }
    return value;
  }
  if (/^\s*[[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const before = redactions;
      const cleaned = scrub(parsed);
      if (redactions !== before) output = JSON.stringify(cleaned);
    } catch { /* Ordinary non-JSON text is redacted by the text patterns below. */ }
  }
  function replace(pattern: RegExp, replacement: string | ((...args: string[]) => string)) {
    output = output.replace(pattern, (...args: string[]) => {
      redactions += 1;
      if (typeof replacement === "function") return replacement(...args);
      return replacement;
    });
  }
  replace(/data:(?:image|audio|video)\/[^\s"'<>;,]+(?:;[^\s"'<>;,]+)*;base64,[a-z0-9+/_=-]+/gi, "[attachment omitted]");
  replace(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, "[redacted:private_key]");
  replace(/\b(https?|postgres|postgresql|mysql|mongodb|redis):\/\/[^\s/:@]+:[^\s/@]+@/gi, (_all, scheme) => `${scheme}://[redacted]@`);
  replace(/\b([\w.-]{0,100}(?:api[_-]?key|secret[_-]?(?:access[_-]?)?key|token|secret|password|passwd))(["']?\s*[:=]\s*)(["']?)(?!\[redacted)([^\s"',}\];]+)/gi,
    (_all, key, separator, quote) => `${key}${separator}${quote}[redacted]`);
  replace(/\b(Bearer\s+)(?!\[redacted)[A-Za-z0-9._~+/-]{8,}={0,2}/gi, (_all, prefix) => `${prefix}[redacted]`);
  replace(/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, "[redacted:anthropic_key]");
  replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted:openai_key]");
  replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted:github_token]");
  replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted:aws_access_key]");
  replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted:slack_token]");
  replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, "[redacted:google_api_key]");
  replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "[redacted:gitlab_token]");
  replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted:jwt]");
  replace(/\/(?:Users|home)\/[^/\s\\"']+/g, "$HOME");
  replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi, "$HOME");
  replace(/\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}\b/gi, "[redacted:email]");
  return { text: output, redactions };
}
