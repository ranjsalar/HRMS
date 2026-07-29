import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleProvider, useTranslation } from "./locale-context";

function Probe({ tKey, params }: { tKey: string; params?: Record<string, string | number> }) {
  const { t } = useTranslation();
  return <span>{t(tKey, params)}</span>;
}

function renderProbe(tKey: string, params?: Record<string, string | number>) {
  return render(
    <LocaleProvider initialLocale="en">
      <Probe tKey={tKey} params={params} />
    </LocaleProvider>,
  );
}

describe("useTranslation().t — interpolation", () => {
  it("returns the plain string unchanged when no params are given", () => {
    renderProbe("dashboard.attendance.title");
    expect(screen.getByText("Today's attendance")).toBeInTheDocument();
  });

  it("substitutes a {{placeholder}} with the given param", () => {
    renderProbe("dashboard.greeting", { name: "Sara" });
    expect(screen.getByText("Welcome, Sara")).toBeInTheDocument();
  });

  it("substitutes multiple distinct placeholders", () => {
    renderProbe("dashboard.attendance.statusClockedIn", { time: "09:04" });
    expect(screen.getByText("Clocked in at 09:04.")).toBeInTheDocument();
  });

  it("leaves an unmatched placeholder literal if no param is supplied for it", () => {
    renderProbe("dashboard.greeting");
    expect(screen.getByText("Welcome, {{name}}")).toBeInTheDocument();
  });
});
