import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalWorkspace } from "./PersonalWorkspace";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("renders the private workspace in English", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  render(<PersonalWorkspace external={false} />);

  expect(document.body.textContent).not.toMatch(/\p{Script=Han}/u);
  fireEvent.change(screen.getByLabelText("Workspace token"), { target: { value: "synthetic-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  expect(await screen.findByLabelText("Private question")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/\p{Script=Han}/u);
});

it.each([[42, 42], [undefined, 8000], [12000, 8000]])("enforces configured limit %s with an effective boundary of %s", async (configured, limit) => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalWorkspace external={false} maxQuestionChars={configured} />);
  fireEvent.change(screen.getByLabelText(/Workspace token/), { target: { value: "synthetic-token" } });
  fireEvent.click(screen.getByRole("button", { name: /Unlock/ }));
  const question = await screen.findByLabelText(/Private question/);
  expect(question).toHaveAttribute("maxlength", String(limit));
  const form = question.closest("form")!;
  fireEvent.change(question, { target: { value: "x".repeat(limit + 1) } });
  fireEvent.submit(form);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(question).toHaveValue("x".repeat(limit + 1));
  fireEvent.change(question, { target: { value: "x".repeat(limit) } });
  fireEvent.submit(form);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/chat"), expect.objectContaining({ body: JSON.stringify({ question: "x".repeat(limit) }) })));
  await waitFor(() => expect(question).toHaveValue(""));
});

it("preserves a draft when the limit shrinks and allows sending after shortening", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const { rerender } = render(<PersonalWorkspace external={false} maxQuestionChars={100} />);
  fireEvent.change(screen.getByLabelText(/Workspace token/), { target: { value: "synthetic-token" } });
  fireEvent.click(screen.getByRole("button", { name: /Unlock/ }));
  const question = await screen.findByLabelText(/Private question/);
  fireEvent.change(question, { target: { value: "x".repeat(43) } });
  rerender(<PersonalWorkspace external={false} maxQuestionChars={42} />);
  expect(question).toHaveValue("x".repeat(43));
  expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
  fireEvent.submit(question.closest("form")!);
  expect(fetcher).toHaveBeenCalledTimes(5);
  fireEvent.change(question, { target: { value: "shortened question" } });
  expect(screen.getByRole("button", { name: /Send/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /Send/ }));
  await waitFor(() => expect(question).toHaveValue(""));
});

it("requires a token, loads persisted memory, and clears private state on lock", async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/entries") ? [{ id: "one", key: "identity.name", kind: "fact", content: "Alex Example", status: "confirmed", source: "manual", updated_at: "2026-01-01" }] : [{ id: "turn", role: "user", content: "Saved question" }],
  ), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalWorkspace external={false} />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Workspace token/), { target: { value: "local-token" } });
  fireEvent.click(screen.getByRole("button", { name: /Unlock/ }));
  expect(await screen.findByText("Alex Example")).toBeInTheDocument();
  expect(screen.getByText("Saved question")).toBeInTheDocument();
  const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(options.headers).toMatchObject({ Authorization: "Bearer local-token" });
  fireEvent.click(screen.getByRole("button", { name: /Lock/ }));
  expect(screen.queryByText("Alex Example")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Workspace token/)).toHaveValue("");
});

it("does not expose the workspace after authentication failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Private workspace token required" }), { status: 401 })));
  render(<PersonalWorkspace external />);
  fireEvent.change(screen.getByLabelText(/Workspace token/), { target: { value: "bad" } });
  fireEvent.click(screen.getByRole("button", { name: /Unlock/ }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Private workspace token required"));
  expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
});

it("identifies duplicate-key memory actions by accessible name and preserves their behavior", async () => {
  const entries = [
    { id: "opaque-a", key: "profile.alias", kind: "fact", content: "River Example", status: "pending", source: "manual", updated_at: "2026-01-01" },
    { id: "opaque-b", key: "profile.alias", kind: "preference", content: "Sky Example", status: "pending", source: "chat", updated_at: "2026-01-02" },
  ];
  let resolveConfirm!: (response: Response) => void;
  const confirmResponse = new Promise<Response>(resolve => { resolveConfirm = resolve; });
  const fetcher = vi.fn((url: string) => {
    if (url.endsWith("/entries/opaque-a/confirm")) return confirmResponse;
    return Promise.resolve(new Response(JSON.stringify(url.endsWith("/entries") ? entries : []), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalWorkspace external={false} />);
  fireEvent.change(screen.getByLabelText(/Workspace token/), { target: { value: "synthetic-token" } });
  fireEvent.click(screen.getByRole("button", { name: /Unlock/ }));
  expect(await screen.findByText("River Example")).toBeInTheDocument();

  const firstConfirm = screen.getByRole("button", { name: "Confirm: profile.alias, memory 1" });
  const secondConfirm = screen.getByRole("button", { name: "Confirm: profile.alias, memory 2" });
  const firstEdit = screen.getByRole("button", { name: "Edit: profile.alias, memory 1" });
  const secondEdit = screen.getByRole("button", { name: "Edit: profile.alias, memory 2" });
  const firstDelete = screen.getByRole("button", { name: "Delete: profile.alias, memory 1" });
  const secondDelete = screen.getByRole("button", { name: "Delete: profile.alias, memory 2" });

  fireEvent.click(firstConfirm);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/entries/opaque-a/confirm"), expect.any(Object)));
  expect(firstConfirm).toBeDisabled();
  expect(secondConfirm).toBeDisabled();
  expect(firstEdit).toBeDisabled();
  expect(secondEdit).toBeDisabled();
  expect(firstDelete).toBeDisabled();
  expect(secondDelete).toBeDisabled();
  resolveConfirm(new Response(JSON.stringify({}), { status: 200 }));
  await waitFor(() => expect(secondEdit).toBeEnabled());

  fireEvent.click(secondEdit);
  expect(screen.getByLabelText(/Content/)).toHaveValue("Sky Example");
  fireEvent.click(secondDelete);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/entries/opaque-b/delete"), expect.any(Object)));
});

it("shows a verified corpus and searches review-only owner evidence", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/corpus/status")) return new Response(JSON.stringify({
      configured: true, verified: true, read_only: true, review_only: true, conversations: 5043,
    }), { status: 200 });
    if (url.endsWith("/corpus/search")) return new Response(JSON.stringify({ results: [{
      evidence_id: "doc_1", source: "codex", timestamp: "2026-01-01", excerpt: "I verify focused changes.",
      trust: "untrusted_corpus", author_role: "owner", review_only: true,
    }] }), { status: 200 });
    return new Response(JSON.stringify([]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalWorkspace external={false} />);
  fireEvent.change(screen.getByLabelText("Workspace token"), { target: { value: "synthetic-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  expect(await screen.findByText("Verified · read only")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search historical evidence"), { target: { value: "verification" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText("I verify focused changes.")).toBeInTheDocument();
  expect(screen.getByText(/untrusted historical evidence/)).toBeInTheDocument();
});
