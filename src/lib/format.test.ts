import { describe, expect, it } from "vitest";
import { formatCents } from "@/lib/format";

describe("formatCents", () => {
  it("formats integer cents as dollars", () => {
    expect(formatCents(5995)).toBe("$59.95");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(100)).toBe("$1.00");
  });

  it("adds thousands separators", () => {
    expect(formatCents(1899500)).toBe("$18,995.00");
  });

  it("handles negative amounts", () => {
    expect(formatCents(-1234)).toBe("-$12.34");
  });

  it("rejects non-integer cents (prices are ALWAYS integer cents in data)", () => {
    expect(() => formatCents(59.95)).toThrow(/integer cents/);
  });
});
