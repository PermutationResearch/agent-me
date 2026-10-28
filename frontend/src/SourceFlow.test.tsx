import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SourceFlow } from "./SourceFlow";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("explains supported sources and possible uses without importing or uploading activity", () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network); render(<SourceFlow />);
  for (const name of ["Claude activity", "Codex activity", "OMP and Pi activity", "Agent-Me reviewed activity", "Prompt and skill optimization", "Evaluation and benchmarking", "Small-model training"]) expect(screen.getByRole("img", { name })).toBeInTheDocument();
  expect(screen.getByText(/An agreement comes before any use/)).toBeInTheDocument();
  expect(network).not.toHaveBeenCalled();
});
