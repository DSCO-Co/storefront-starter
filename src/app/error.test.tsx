/**
 * Proves error.tsx's contract: a caught error renders the generic fallback
 * (never the raw message/stack) plus the correlation id when one is
 * carried on the error, and `reset()` is wired to the "Try again" button.
 * Mirrors console's panel-boundary.test.tsx.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppClientError } from "@/lib/client-error";
import ErrorBoundary from "./error";

afterEach(cleanup);

describe("error.tsx", () => {
  it("renders a generic fallback, not the raw error message", () => {
    const reset = vi.fn();
    const error = new Error("boom: raw internal stack detail") as Error & { digest?: string };

    const { getByRole, queryByText } = render(<ErrorBoundary error={error} reset={reset} />);

    const alert = getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");
    expect(queryByText(/boom: raw internal stack detail/)).toBeNull();
  });

  it("shows the correlation id when the error carries one", () => {
    const reset = vi.fn();
    const error = new AppClientError("checkout failed", "req_abc123");

    const { getByTestId } = render(<ErrorBoundary error={error} reset={reset} />);

    expect(getByTestId("error-correlation-id").textContent).toContain("req_abc123");
  });

  it("omits the correlation id line when there is none", () => {
    const reset = vi.fn();
    const error = new Error("plain failure") as Error & { digest?: string };

    const { queryByTestId } = render(<ErrorBoundary error={error} reset={reset} />);

    expect(queryByTestId("error-correlation-id")).toBeNull();
  });

  it("calls reset() when the retry button is clicked", () => {
    const reset = vi.fn();
    const error = new Error("boom") as Error & { digest?: string };

    const { getByText } = render(<ErrorBoundary error={error} reset={reset} />);
    fireEvent.click(getByText("Try again"));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
