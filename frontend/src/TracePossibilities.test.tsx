import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { TracePossibilities } from "./TracePossibilities";

afterEach(cleanup);

it("starts with the trace offer path and explains that submission is not a sale", () => {
  render(<TracePossibilities />);
  expect(screen.getByRole("button", { name: /Sell selected traces/ })).toHaveAttribute("aria-pressed", "true");
  const panel = screen.getByRole("region", { name: "Your experience. A considered offer." });
  expect(within(panel).getByRole("link", { name: /Review my traces/ })).toHaveAttribute("href", "/traces");
  expect(within(panel).getByText(/A purchase requires a separate agreement and payment/)).toBeInTheDocument();
});

it("reveals the real local GEPA workflow without promising measured improvements", async () => {
  const user = userEvent.setup(); render(<TracePossibilities />);
  await user.click(screen.getByRole("button", { name: /Improve prompts & skills/ }));
  const panel = screen.getByRole("region", { name: "Give your next prompt more experience." });
  expect(within(panel).getByRole("link", { name: /Open local workspace/ })).toHaveAttribute("href", "/workspace");
  expect(within(panel).getByText(/GEPA Optimize Anything/)).toBeInTheDocument();
  expect(within(panel).getByText(/Scores are model-judge estimates/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Sell selected traces/ })).toHaveAttribute("aria-pressed", "false");
});

it("positions evaluations as an export workflow rather than a generated harness", async () => {
  const user = userEvent.setup(); render(<TracePossibilities />);
  await user.click(screen.getByRole("button", { name: /Build evaluations/ }));
  const panel = screen.getByRole("region", { name: "Test against the work that matters." });
  expect(within(panel).getByText("Export workflow")).toBeInTheDocument();
  expect(within(panel).getByText(/Agent-Me does not generate or run your harness yet/)).toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: /Prepare evaluation examples/ })).toHaveAttribute("href", "/traces");
});

it("positions model examples as preparation with training explicitly separate", async () => {
  const user = userEvent.setup(); render(<TracePossibilities />);
  await user.click(screen.getByRole("button", { name: /Prepare model examples/ }));
  const panel = screen.getByRole("region", { name: "Start a smaller model with your kind of work." });
  expect(within(panel).getByText("Prepare for training")).toBeInTheDocument();
  expect(within(panel).getByText(/Model training is a separate workflow/)).toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: /Curate model examples/ })).toHaveAttribute("href", "/traces");
});
