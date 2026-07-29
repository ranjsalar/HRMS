import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ServerError } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { ErrorState } from "./ErrorState";

function renderWithLocale(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="en">{ui}</LocaleProvider>);
}

describe("ErrorState — classifies caught errors into distinct presentations", () => {
  it("a ForbiddenError renders the access-denied state, no retry button", () => {
    renderWithLocale(<ErrorState error={new ForbiddenError("nope", 403, null)} />);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("a NotFoundError renders the not-found state, no retry button", () => {
    renderWithLocale(<ErrorState error={new NotFoundError("nope", 404, null)} />);
    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("any other error (e.g. ServerError) renders the generic state WITH a retry button, when onRetry is provided", async () => {
    const onRetry = vi.fn();
    renderWithLocale(<ErrorState error={new ServerError("boom", 500, null)} onRetry={onRetry} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Retry" });
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a ConflictError renders the conflict state, no retry button", () => {
    renderWithLocale(<ErrorState error={new ConflictError("nope", 409, null)} />);
    expect(screen.getByText("Can't complete this")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("a plain unclassified error also renders the generic state", () => {
    renderWithLocale(<ErrorState error={new Error("network down")} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("an explicit kind overrides classification from `error`", () => {
    renderWithLocale(<ErrorState error={new ServerError("boom", 500, null)} kind="notFound" />);
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });
});
