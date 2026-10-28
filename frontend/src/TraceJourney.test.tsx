import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { TraceJourney } from "./TraceJourney";
afterEach(cleanup);
it("explains each submission step with the appropriate next action", async () => {
  render(<TraceJourney />); const user = userEvent.setup();
  expect(screen.getByRole("link", { name: "Review your traces" })).toHaveAttribute("href", "/traces");
  await user.click(screen.getByRole("button", { name: /Submit a selection/ }));
  expect(screen.getByRole("link", { name: "Prepare a submission" })).toHaveAttribute("href", "/submit");
  await user.click(screen.getByRole("button", { name: /Consider an offer/ }));
  expect(screen.getByRole("link", { name: "Open your receipt" })).toHaveAttribute("href", "/submissions");
  expect(screen.getByText(/No automatic sale/)).toBeInTheDocument();
});
