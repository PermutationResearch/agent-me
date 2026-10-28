import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProductHome, PrivacyPage } from "./ProductHome";
afterEach(cleanup);
it("makes trace preparation, explicit submission and receipt access reachable", () => {
  render(<ProductHome />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The work behind your AI.Yours to own. Yours to sell.");
  for (const link of screen.getAllByRole("link", { name: /Review my traces/ })) expect(link).toHaveAttribute("href", "/traces");
  expect(screen.getByRole("link", { name: /Already have an export/ })).toHaveAttribute("href", "/submit");
  expect(screen.getByRole("link", { name: "My submission" })).toHaveAttribute("href", "/submissions");
  expect(screen.getByText(/No automatic sale/)).toBeInTheDocument();
});
it("explains withdrawal and separate agreement without inventing payout guarantees", () => {
  render(<PrivacyPage />);
  expect(screen.getByRole("heading", { name: "Your data, from selection to review." })).toBeInTheDocument();
  expect(screen.getByText(/Withdrawal removes the submitted activity/)).toBeInTheDocument();
  expect(screen.getByText(/separate agreement and payment/)).toBeInTheDocument();
});
