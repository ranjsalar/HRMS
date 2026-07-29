import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { ClockWidget } from "./ClockWidget";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderWidget() {
  return render(
    <LocaleProvider initialLocale="en">
      <ClockWidget />
    </LocaleProvider>,
  );
}

/** Stands in for the browser geolocation API — absent entirely by default (jsdom has no navigator.geolocation), same as a real browser without location support. */
function mockGeolocation(
  behavior: "success" | "denied" | "unavailable" | "absent",
): void {
  if (behavior === "absent") {
    Reflect.deleteProperty(navigator, "geolocation");
    return;
  }
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (
        success: PositionCallback,
        error?: PositionErrorCallback,
      ) => {
        if (behavior === "success") {
          success({
            coords: { latitude: 36.19, longitude: 44.01 },
          } as GeolocationPosition);
        } else if (error) {
          const code = behavior === "denied" ? 1 : 2;
          error({ code, PERMISSION_DENIED: 1 } as GeolocationPositionError);
        }
      },
    },
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("ClockWidget — today's status", () => {
  it("shows 'not clocked in' and a Clock in button when there's no record for today", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderWidget();

    expect(await screen.findByText("You haven't clocked in today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock in" })).toBeInTheDocument();
  });

  it("shows the clock-in time and a Clock out button when today has an open record", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "r1", employeeId: "e1", clockIn: "2026-07-28T09:04:00.000Z", clockOut: null, withinGeofence: null },
    ]);
    renderWidget();

    expect(await screen.findByRole("button", { name: "Clock out" })).toBeInTheDocument();
    expect(screen.getByText(/^Clocked in at/)).toBeInTheDocument();
  });

  it("shows a geofence warning when the most recent record was flagged outside the branch geofence", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "r1", employeeId: "e1", clockIn: "2026-07-28T09:04:00.000Z", clockOut: null, withinGeofence: false },
    ]);
    renderWidget();

    expect(await screen.findByText("Outside your assigned work location")).toBeInTheDocument();
    expect(
      screen.getByText("This was recorded, but you appear to be outside your assigned work location."),
    ).toBeInTheDocument();
  });

  it("renders the generic error state with a working retry when the initial load fails", async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error("network down"));
    mockedApiFetch.mockResolvedValueOnce([]);
    renderWidget();

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("You haven't clocked in today.")).toBeInTheDocument();
  });
});

describe("ClockWidget — clocking in/out with geolocation", () => {
  it("clocking in with geolocation available sends coordinates and flips to the clocked-in state", async () => {
    mockGeolocation("success");
    mockedApiFetch.mockResolvedValueOnce([]); // initial load: nothing today
    mockedApiFetch.mockResolvedValueOnce({
      id: "r1",
      employeeId: "e1",
      clockIn: "2026-07-28T09:04:00.000Z",
      clockOut: null,
      withinGeofence: true,
    });
    renderWidget();

    await userEvent.click(await screen.findByRole("button", { name: "Clock in" }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith("/attendance/clock-in", {
        method: "POST",
        body: { lat: 36.19, lng: 44.01 },
      }),
    );
    expect(await screen.findByRole("button", { name: "Clock out" })).toBeInTheDocument();
  });

  it("clocking in with geolocation permission denied still clocks in, without coordinates, and shows a non-blocking notice", async () => {
    mockGeolocation("denied");
    mockedApiFetch.mockResolvedValueOnce([]);
    mockedApiFetch.mockResolvedValueOnce({
      id: "r1",
      employeeId: "e1",
      clockIn: "2026-07-28T09:04:00.000Z",
      clockOut: null,
      withinGeofence: null,
    });
    renderWidget();

    await userEvent.click(await screen.findByRole("button", { name: "Clock in" }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith("/attendance/clock-in", {
        method: "POST",
        body: {},
      }),
    );
    expect(
      await screen.findByText("Location access was denied. You can still clock in — this will be recorded without location data."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock out" })).toBeInTheDocument();
  });

  it("clocking in with no geolocation API at all (unsupported browser) still succeeds", async () => {
    mockGeolocation("absent");
    mockedApiFetch.mockResolvedValueOnce([]);
    mockedApiFetch.mockResolvedValueOnce({
      id: "r1",
      employeeId: "e1",
      clockIn: "2026-07-28T09:04:00.000Z",
      clockOut: null,
      withinGeofence: null,
    });
    renderWidget();

    await userEvent.click(await screen.findByRole("button", { name: "Clock in" }));

    expect(
      await screen.findByText("We couldn't determine your location. You can still clock in — this will be recorded without location data."),
    ).toBeInTheDocument();
  });

  it("clocking out sends coordinates and flips back to the not-clocked-in-yet-today display with the clock-out time", async () => {
    mockGeolocation("success");
    mockedApiFetch.mockResolvedValueOnce([
      { id: "r1", employeeId: "e1", clockIn: "2026-07-28T09:04:00.000Z", clockOut: null, withinGeofence: null },
    ]);
    mockedApiFetch.mockResolvedValueOnce({
      id: "r1",
      employeeId: "e1",
      clockIn: "2026-07-28T09:04:00.000Z",
      clockOut: "2026-07-28T17:00:00.000Z",
      withinGeofence: true,
    });
    renderWidget();

    await userEvent.click(await screen.findByRole("button", { name: "Clock out" }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith("/attendance/clock-out", {
        method: "POST",
        body: { lat: 36.19, lng: 44.01 },
      }),
    );
    expect(await screen.findByText(/^Clocked out at/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock in" })).toBeInTheDocument();
  });

  it("shows an inline error and stays actionable when the clock-in request itself fails", async () => {
    mockGeolocation("success");
    mockedApiFetch.mockResolvedValueOnce([]);
    mockedApiFetch.mockRejectedValueOnce(new Error("conflict"));
    renderWidget();

    await userEvent.click(await screen.findByRole("button", { name: "Clock in" }));

    expect(await screen.findByText("An unexpected error occurred. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock in" })).not.toBeDisabled();
  });
});
