import { describe, expect, it } from "vitest";
import {
  containsCopyToken,
  defaultCopyVars,
  resolveCopyTokens,
  sanitizeCopyDeep,
} from "@/lib/copy-tokens";

// Handlebars fragments are built from charcodes, not literals: raw `{`/`}`
// inside string literals would unbalance check-conventions' brace-body scan
// (rule 38 test-without-assertion) and hide these tests' assertions from it.
const OPEN = String.fromCharCode(123).repeat(2); // "{{"
const CLOSE = String.fromCharCode(125).repeat(2); // "}}"
const hb = (name: string) => `${OPEN}${name}${CLOSE}`;

describe("resolveCopyTokens", () => {
  it("resolves known tokens", () => {
    expect(resolveCopyTokens(`Save with ${hb("WALLET_BRAND")} today`, defaultCopyVars())).toBe(
      "Save with RUO Pay today",
    );
    expect(resolveCopyTokens(`Welcome to ${hb("STORE_NAME")}`, defaultCopyVars("Leo Labs"))).toBe(
      "Welcome to Leo Labs",
    );
  });

  it("strips unknown tokens and reports them — never renders raw handlebars", () => {
    const unknown: string[] = [];
    const out = resolveCopyTokens(`Pay with ${hb("MYSTERY_TOKEN")} now`, {}, (t) =>
      unknown.push(t),
    );
    expect(out).toBe("Pay with now");
    expect(out).not.toContain(OPEN);
    expect(unknown).toEqual(["MYSTERY_TOKEN"]);
  });

  it("makes unterminated/nested fragments unrenderable too", () => {
    const inputs = [
      `oops ${OPEN}broken`,
      `${OPEN}${hb("WALLET_BRAND")}${CLOSE}`,
      `${OPEN} ${CLOSE}`,
      `a ${hb("x")} b ${OPEN}`,
    ];
    for (const input of inputs) {
      expect(resolveCopyTokens(input, defaultCopyVars())).not.toContain(OPEN);
    }
  });

  it("leaves token-free copy byte-identical", () => {
    const text = "Plain copy — no tokens, keeps  spacing.";
    expect(resolveCopyTokens(text)).toBe(text);
    expect(containsCopyToken(text)).toBe(false);
  });
});

describe("sanitizeCopyDeep", () => {
  it("sanitizes every string leaf in nested props", () => {
    const props = {
      title: `About ${hb("STORE_NAME")}`,
      items: [{ label: `${hb("WALLET_BRAND")} accepted` }, { label: "clean" }],
      count: 3,
      flag: true,
      nothing: null,
    };
    const out = sanitizeCopyDeep(props, defaultCopyVars("Acme"));
    expect(out.title).toBe("About Acme");
    expect(out.items[0]?.label).toBe("RUO Pay accepted");
    expect(out.items[1]?.label).toBe("clean");
    expect(out.count).toBe(3);
    expect(JSON.stringify(out)).not.toContain(OPEN);
  });

  it("preserves object identity when nothing needs resolving", () => {
    const props = { title: "clean", items: [{ label: "also clean" }] };
    expect(sanitizeCopyDeep(props, defaultCopyVars())).toBe(props);
  });
});
