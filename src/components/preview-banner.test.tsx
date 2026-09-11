import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PreviewBanner } from "./preview-banner";

afterEach(cleanup);

describe("PreviewBanner", () => {
  it("labels the render as an unpublished preview, with the version, under a stable testid", () => {
    const { getByTestId } = render(<PreviewBanner version={7} />);
    const banner = getByTestId("preview-banner");
    expect(banner.textContent).toContain("Preview — not published");
    expect(banner.textContent).toContain("version 7");
  });

  it("is fixed and painted from theme tokens (renders on any palette)", () => {
    const { getByTestId } = render(<PreviewBanner version={1} />);
    const style = getByTestId("preview-banner").getAttribute("style") ?? "";
    expect(style).toContain("position: fixed");
    expect(style).toContain("var(--color-primary)");
  });
});
