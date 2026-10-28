import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.history.replaceState(null, "", "/"); });
it("opens the trace business homepage without loading private profile data", () => {
  window.history.replaceState(null, "", "/"); const network = vi.fn(); vi.stubGlobal("fetch", network);
  render(<App />); expect(screen.getByRole("link", { name: /Start your review/ })).toHaveAttribute("href", "/traces"); expect(network).not.toHaveBeenCalled();
});
it("shows receipt lookup with an ID and keeps access codes out of the URL", () => {
  window.history.replaceState(null, "", "/submissions/sub_test"); const network = vi.fn(); vi.stubGlobal("fetch", network);
  render(<App />); expect(screen.getByLabelText("Submission ID")).toHaveValue("sub_test"); expect(screen.getByLabelText("Private receipt code")).toHaveValue(""); expect(network).not.toHaveBeenCalled();
});
it("provides a helpful unknown-route screen", () => {
  window.history.replaceState(null, "", "/missing"); render(<App />); expect(screen.getByRole("link", { name: /Back to Agent-Me/ })).toHaveAttribute("href", "/");
});

it("keeps the example workspace out of the public marketplace build", () => {
  vi.stubEnv("VITE_PUBLIC_MARKET", "true");
  window.history.replaceState(null, "", "/workspace");
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  render(<App />);
  expect(screen.getByRole("heading", { name: "We could not find this page." })).toBeInTheDocument();
  expect(network).not.toHaveBeenCalled();
});
it("preserves the example workspace for local builds", () => {
  vi.stubEnv("VITE_PUBLIC_MARKET", "");
  window.history.replaceState(null, "", "/workspace");
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => undefined)));
  render(<App />);
  expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
});
