import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { announce, LiveAnnouncer } from "./live-announcer";

describe("LiveAnnouncer (D6)", () => {
  afterEach(cleanup);

  it("renders a polite status region and voices announce() messages", async () => {
    render(<LiveAnnouncer />);
    const region = screen.getByTestId("live-announcer");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe("");

    announce("Added BPC-157 to cart");
    await waitFor(() => expect(region.textContent).toBe("Added BPC-157 to cart"));
  });

  it("re-announces an identical repeated message (clear-then-set)", async () => {
    render(<LiveAnnouncer />);
    const region = screen.getByTestId("live-announcer");
    announce("Cart updated: 2 items");
    await waitFor(() => expect(region.textContent).toBe("Cart updated: 2 items"));
    announce("Cart updated: 2 items");
    await waitFor(() => expect(region.textContent).toBe("Cart updated: 2 items"));
  });

  it("announce() without a mounted region is a harmless no-op (never throws)", () => {
    expect(() => announce("nobody listening")).not.toThrow();
  });
});
