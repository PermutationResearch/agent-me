import { afterEach, expect, it, vi } from "vitest";
import { buyerInbox, createReceiptCode, getSubmission, MarketError, submitPack } from "./marketApi";
import type { SubmissionPayload } from "./marketApi";

afterEach(() => { vi.unstubAllGlobals(); });
it("uses private bearer headers and no-store without secrets in URLs", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "pack" }) }); vi.stubGlobal("fetch", fetcher);
  await getSubmission("abc/id", "private-code");
  expect(fetcher).toHaveBeenCalledWith("/api/v1/trace-submissions/abc%2Fid", expect.objectContaining({ headers: { Authorization: "Bearer private-code" }, cache: "no-store" }));
  await buyerInbox("buyer-key", { status: "under_review", offset: 30, limit: 30 });
  expect(fetcher.mock.calls[1][0]).toBe("/api/v1/buyer/trace-submissions?status=under_review&offset=30&limit=30");
});
it("transmits only the explicit submission payload and supplied retry code", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ submission: { id: "test" } }) }); vi.stubGlobal("fetch", fetcher);
  const payload = { pack: { id: "selected-only" }, title: "Reviewed", contributor_alias: "", confirm_submission: true } as SubmissionPayload;
  await submitPack(payload, "stable-code");
  expect(fetcher.mock.calls[0][1].body).toBe(JSON.stringify(payload));
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer stable-code");
});
it("classifies backend and non-JSON proxy failures without exposing response bodies", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: "Invalid private receipt code." }) }));
  await expect(getSubmission("id", "wrong")).rejects.toEqual(new MarketError(401, "Invalid private receipt code."));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw Error("private proxy body"); } }));
  await expect(getSubmission("id", "code")).rejects.toThrow("The request could not be completed.");
});
it("creates distinct 256-bit URL-safe receipt codes", () => {
  const first = createReceiptCode(); expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(createReceiptCode()).not.toBe(first);
});
