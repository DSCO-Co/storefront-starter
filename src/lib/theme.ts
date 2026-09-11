/**
 * Theme derivation (LOO-3140) — the layer between a store's DTCG tokens and
 * the CSS custom properties the design system consumes.
 *
 * The manifest contract only REQUIRES the core roles (primary, accent,
 * background, surface, text, muted, …). The dual-identity component set
 * additionally consumes an EXTENDED vocabulary — surface elevations, an ink
 * scale, hairlines, a secondary accent, glows, inverse-band colors, display/
 * data fonts, motion. A store may declare any of those tokens explicitly;
 * every one it does NOT declare is DERIVED here from the core roles, so
 * today's manifests keep rendering unchanged while richer manifests can pin
 * every value.
 *
 * Derivation is pure string→string math over the flattened var map — no DOM,
 * no I/O — and only ever FILLS GAPS: an explicitly declared token always wins
 * over a derived value.
 */

import { flattenTokens } from "@/lib/tokens";

// ---------------------------------------------------------------------------
// Color math (sRGB, integer channels; alpha 0..1)
// ---------------------------------------------------------------------------

export type Rgba = { r: number; g: number; b: number; a: number };

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parse a CSS color literal (#rgb/#rgba/#rrggbb/#rrggbbaa, rgb(), rgba()).
 * Returns null for anything else (var() references, hsl(), named colors) —
 * derivation then skips the color-dependent vars rather than guessing.
 */
export function parseCssColor(value: string): Rgba | null {
  const trimmed = value.trim();
  const hex = HEX_RE.exec(trimmed);
  if (hex?.[1]) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const chars = h.split("");
      const [r, g, b] = chars.slice(0, 3).map((c) => Number.parseInt(c + c, 16));
      const alphaChar = h.length === 4 ? h[3] : null;
      const a = alphaChar ? Number.parseInt(alphaChar + alphaChar, 16) / 255 : 1;
      if (r === undefined || g === undefined || b === undefined) return null;
      return { r, g, b, a };
    }
    if (h.length === 6 || h.length === 8) {
      const r = Number.parseInt(h.slice(0, 2), 16);
      const g = Number.parseInt(h.slice(2, 4), 16);
      const b = Number.parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }
  const rgb = RGB_RE.exec(trimmed);
  if (rgb) {
    const [, rs, gs, bs, as] = rgb;
    const r = Number(rs);
    const g = Number(gs);
    const b = Number(bs);
    const a = as === undefined ? 1 : Number(as);
    if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
    return {
      r: Math.min(255, Math.round(r)),
      g: Math.min(255, Math.round(g)),
      b: Math.min(255, Math.round(b)),
      a: Math.min(1, Math.max(0, a)),
    };
  }
  return null;
}

function clampChannel(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

/** Linear-interpolate `a` toward `b` by `t` (0 = a, 1 = b). */
export function mixColors(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: clampChannel(a.r + (b.r - a.r) * t),
    g: clampChannel(a.g + (b.g - a.g) * t),
    b: clampChannel(a.b + (b.b - a.b) * t),
    a: a.a + (b.a - a.a) * t,
  };
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { ...color, a: alpha };
}

export function serializeColor(color: Rgba): string {
  if (color.a >= 1) {
    const to2 = (n: number) => n.toString(16).padStart(2, "0");
    return `#${to2(color.r)}${to2(color.g)}${to2(color.b)}`;
  }
  const alpha = Math.round(color.a * 100) / 100;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** WCAG relative luminance (0 black … 1 white). */
export function relativeLuminance(color: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function isDarkColor(color: Rgba): boolean {
  return relativeLuminance(color) < 0.4;
}

/** WCAG contrast ratio, 1 (identical) … 21 (black on white). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ThemeContrastFinding {
  readonly pair: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly floor: number;
}

/**
 * Contrast floors for the core text-bearing token pairs (consumer-compliance
 * remediation 2026-09-09, audit F4: tenant themes were never contrast-checked).
 * Body-text pairs hold WCAG 2.1 AA 4.5:1; `muted` is held to 3:1 — it is
 * secondary/large-scale text by design, and a 4.5 floor there would flag most
 * intentional muted inks (this is a floor against illegibility, not an AA
 * claim for muted text). Advisory, never render-blocking: callers log
 * findings — a low-contrast store is a defect to surface, a refused render
 * would be a worse one.
 */
export function themeContrastFindings(tokens: Record<string, unknown>): ThemeContrastFinding[] {
  const flattened = flattenTokens(tokens);
  const pick = (name: string): Rgba | null => {
    const raw = flattened.get(name);
    return typeof raw === "string" ? parseCssColor(raw) : null;
  };
  const pairs: ReadonlyArray<{ pair: string; fg: string; bg: string; floor: number }> = [
    { pair: "text-on-background", fg: "--color-text", bg: "--color-background", floor: 4.5 },
    { pair: "text-on-surface", fg: "--color-text", bg: "--color-surface", floor: 4.5 },
    {
      pair: "primary-foreground-on-primary",
      fg: "--color-primary-foreground",
      bg: "--color-primary",
      floor: 4.5,
    },
    { pair: "muted-on-background", fg: "--color-muted", bg: "--color-background", floor: 3 },
  ];
  const findings: ThemeContrastFinding[] = [];
  for (const { pair, fg, bg, floor } of pairs) {
    const f = pick(fg);
    const b = pick(bg);
    // Absent tokens are not findings — derivation fills defaults elsewhere;
    // only a PRESENT pair that fails its floor is a defect.
    if (f === null || b === null) continue;
    const ratio = contrastRatio(f, b);
    if (ratio < floor) {
      findings.push({
        pair,
        foreground: flattened.get(fg) as string,
        background: flattened.get(bg) as string,
        ratio: Math.round(ratio * 100) / 100,
        floor,
      });
    }
  }
  return findings;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 10, g: 12, b: 16, a: 1 };

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Platform-neutral status defaults (only used when a store declares none) —
 * standard alert hues, not brand colors.
 */
const STATUS_DEFAULTS: Record<string, string> = {
  "--color-success": "#16a249",
  "--color-warning": "#f59f0a",
  "--color-error": "#ef4343",
};

const MONO_STACK =
  "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Fill every missing extended-vocabulary var from the core roles. Never
 * overwrites an explicitly declared var. Pure; returns ONLY the additions.
 */
export function deriveTokenVars(flattened: Map<string, string>): Map<string, string> {
  const derived = new Map<string, string>();
  const has = (name: string) => flattened.has(name) || derived.has(name);
  const put = (name: string, value: string) => {
    if (!has(name)) derived.set(name, value);
  };
  const color = (name: string): Rgba | null => {
    const raw = flattened.get(name) ?? derived.get(name);
    return raw ? parseCssColor(raw) : null;
  };

  const bg = color("--color-background");
  const text = color("--color-text");
  const accent = color("--color-accent");
  const primary = color("--color-primary");

  if (bg && text) {
    const dark = isDarkColor(bg);
    const towardText = (t: number) => serializeColor(mixColors(bg, text, t));
    const towardBg = (t: number) => serializeColor(mixColors(text, bg, t));

    // Surface elevation ladder: dark grounds lift toward the ink, light
    // grounds tint gently the same way (reads as warm gray on white).
    put(
      "--color-surface-1",
      dark ? towardText(0.035) : (flattened.get("--color-surface") ?? towardText(0)),
    );
    put("--color-surface-2", towardText(dark ? 0.07 : 0.03));
    put("--color-surface-3", towardText(dark ? 0.11 : 0.06));
    put("--color-surface-muted", towardText(dark ? 0.05 : 0.04));

    // Ink scale: 1 = display ink, 4 = faint annotation.
    put("--color-ink-1", serializeColor(text));
    put("--color-ink-2", towardBg(dark ? 0.18 : 0.16));
    put("--color-ink-3", flattened.get("--color-muted") ?? towardBg(0.45));
    put("--color-ink-4", towardBg(dark ? 0.58 : 0.6));

    // Hairlines: the ink at low alpha, so they sit on any band.
    put("--color-line", serializeColor(withAlpha(text, dark ? 0.16 : 0.14)));
    put("--color-line-soft", serializeColor(withAlpha(text, dark ? 0.09 : 0.07)));

    // Inverse band: on a light store this is the brand-dark band (primary);
    // on a dark store it is a lifted elevation of the same ground.
    const inverse = dark ? mixColors(bg, text, 0.07) : (primary ?? BLACK);
    put("--color-surface-inverse", serializeColor(inverse));
    const inverseText = dark
      ? text
      : (color("--color-primary-foreground") ?? (isDarkColor(inverse) ? WHITE : BLACK));
    put("--color-inverse-text", serializeColor(inverseText));
    put("--color-inverse-muted", serializeColor(withAlpha(inverseText, 0.72)));
    put("--color-inverse-line", serializeColor(withAlpha(inverseText, 0.18)));

    // RUO Pay wordmark ink (LOO-3147): the express-wallet lockup picks its
    // variant from the store's ground — the light-ink lockup on dark stores,
    // the dark-ink lockup on light stores (the vector pack's dark/light
    // pair). A store may pin `--ruo-pay-ink` explicitly like any other token.
    put("--ruo-pay-ink", dark ? "#ffffff" : "#0b1022");
  }

  if (accent) {
    put("--color-accent-2", serializeColor(mixColors(accent, WHITE, 0.35)));
    put("--color-glow", serializeColor(withAlpha(accent, 0.28)));
    put("--color-glow-soft", serializeColor(withAlpha(accent, 0.14)));
    put("--color-warm", derived.get("--color-accent-2") ?? serializeColor(accent));
  }
  if (primary && !has("--color-primary-foreground")) {
    put("--color-primary-foreground", isDarkColor(primary) ? "#ffffff" : serializeColor(BLACK));
  }

  for (const [name, value] of Object.entries(STATUS_DEFAULTS)) put(name, value);

  // Type roles: display falls back to the heading face, data to the mono stack.
  put("--font-display", flattened.get("--font-heading") ?? "var(--font-heading)");
  put("--font-data", MONO_STACK);
  put("--font-heading-weight", "500");

  // Shape + motion.
  put("--radius-card", "16px");
  put("--radius-button", "9999px");
  put("--radius-pill", "9999px");
  put("--radius-image", flattened.get("--radius-card") ?? derived.get("--radius-card") ?? "16px");
  put("--motion-duration-fast", "150ms");
  put("--motion-duration-normal", "300ms");
  put("--motion-duration-slow", "500ms");
  put("--motion-ease", "cubic-bezier(0.22, 0.61, 0.36, 1)");

  return derived;
}

/**
 * The camelCase↔kebab-case bridge for `surfaceMuted` (audit gap T1): the
 * flattener kebab-cases every key, but shipped components historically read
 * `var(--color-surfaceMuted)` (camelCase — a name no token could ever feed,
 * since CSS custom properties are case-sensitive). Components now read the
 * kebab name; this alias keeps any remaining camelCase reader working.
 */
export function camelAliasVars(all: Map<string, string>): Map<string, string> {
  const aliases = new Map<string, string>();
  if (all.has("--color-surface-muted") && !all.has("--color-surfaceMuted")) {
    aliases.set("--color-surfaceMuted", "var(--color-surface-muted)");
  }
  return aliases;
}

/** Flatten + derive + alias → the full per-store `:root { … }` block. */
export function themeToRootCss(tokens: Record<string, unknown>): string {
  const flattened = flattenTokens(tokens);
  const derived = deriveTokenVars(flattened);
  const all = new Map([...flattened, ...derived]);
  const aliases = camelAliasVars(all);
  const lines = [...all, ...aliases].map(([name, value]) => `${name}: ${value};`).join("\n");
  return `:root {\n${lines}\n}`;
}

// ---------------------------------------------------------------------------
// Structural theme variants (read from the token JSON, not from CSS)
// ---------------------------------------------------------------------------

// `NavStyle`/`FooterStyle`/`ThemeVariants` moved to
// `@dscodotco/storefront-sections` (structural section types). Re-exported so
// `@/lib/theme` callers are unchanged; the token-tree math (`readThemeVariants`,
// `deriveTokenVars`, …) stays here.
import type {
  FooterStyle,
  NavStyle,
  ThemeVariants,
} from "@dscodotco/storefront-sections/model/theme";

export type { FooterStyle, NavStyle, ThemeVariants };

function leafValue(tokens: Record<string, unknown>, group: string, key: string): string | null {
  const g = tokens[group];
  if (typeof g !== "object" || g === null) return null;
  const leaf = (g as Record<string, unknown>)[key];
  if (typeof leaf !== "object" || leaf === null) return null;
  const value = (leaf as Record<string, unknown>).$value;
  return typeof value === "string" ? value : null;
}

/**
 * Structural variants can't ride CSS vars (they pick component ARCHITECTURE,
 * not paint), so they are read from the token tree directly. Unknown values
 * fall back to the safe default — a newer manifest never breaks the renderer.
 */
export function readThemeVariants(tokens: Record<string, unknown>): ThemeVariants {
  const nav = leafValue(tokens, "nav", "style");
  const hero = leafValue(tokens, "hero", "style");
  const footer = leafValue(tokens, "footer", "style");
  return {
    navStyle: nav === "glass-pill" ? "glass-pill" : "classic",
    heroStyle: hero === "starfield" ? "starfield" : hero === "gradient" ? "gradient" : null,
    footerStyle: footer === "minimal" ? "minimal" : footer === "centered" ? "centered" : "columns",
  };
}
