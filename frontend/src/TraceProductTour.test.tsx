import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TraceProductTour } from "./TraceProductTour";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps an actual selection when moving between the review and sharing views", async () => {
  const user = userEvent.setup(); render(<TraceProductTour />);
  expect(screen.getByRole("button", { name: "See the work behind every answer" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("checkbox", { name: "Include user request" }));
  await user.click(screen.getByRole("button", { name: "Your data goes where you decide." }));
  expect(screen.getByRole("heading", { name: "Keep a copy. Share a selection." })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep the useful parts. Leave the rest." }));
  expect(screen.getByRole("checkbox", { name: "Include user request" })).toBeChecked();
  expect(screen.getByLabelText("Example selected record count")).toHaveTextContent("1");
});

it("explains export and explicit submission without sending the example", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const user = userEvent.setup(); render(<TraceProductTour />);
  await user.click(screen.getByRole("button", { name: "Your data goes where you decide." }));
  const view = screen.getByRole("region", { name: "Export and sharing example" });
  expect(within(view).getByText(/Downloading an export does not submit it/)).toBeInTheDocument();
  expect(within(view).getByRole("link", { name: "Prepare your own selection" })).toHaveAttribute("href", "/traces");
  expect(network).not.toHaveBeenCalled();
});

it("shows the receipt path without inventing a price or a completed purchase", async () => {
  const user = userEvent.setup(); render(<TraceProductTour />);
  await user.click(screen.getByRole("button", { name: "A clear offer. Your final say." }));
  const view = screen.getByRole("region", { name: "Private receipt example" });
  expect(within(view).getByText(/No automatic sale/)).toBeInTheDocument();
  expect(within(view).getByText(/A separate agreement and payment/)).toBeInTheDocument();
  expect(within(view).getByRole("link", { name: "Open your private receipt" })).toHaveAttribute("href", "/submissions");
});
