import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityPreview } from "./ActivityPreview";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("lets visitors inspect a fictional selected subset without sending data", () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network); render(<ActivityPreview />);
  expect(screen.getByText("Fictional example")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Preview selected activity" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include user request" }));
  expect(screen.getByLabelText("Example selected record count")).toHaveTextContent("1");
  fireEvent.click(screen.getByRole("button", { name: "Preview selected activity" }));
  const list = screen.getByRole("list", { name: "Example activity records" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  expect(list).toHaveTextContent("Review the changes before publishing.");
  expect(list).not.toHaveTextContent("npm test");
  expect(network).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: /Start with your own files/ })).toHaveAttribute("href", "/traces");
});
it("filters tool activity while keeping the selection intact", () => {
  render(<ActivityPreview />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Include user request" }));
  fireEvent.click(screen.getByRole("button", { name: "Tool activity" }));
  const list = screen.getByRole("list", { name: "Example activity records" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(list).toHaveTextContent("npm test");
  expect(screen.getByLabelText("Example selected record count")).toHaveTextContent("1");
  fireEvent.click(screen.getByRole("button", { name: "All activity" }));
  expect(screen.getByRole("checkbox", { name: "Include user request" })).toBeChecked();
});
