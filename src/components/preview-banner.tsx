/**
 * The draft-preview marker — the ONE honest signal that the page being
 * rendered is an unpublished manifest version, not the live site (its
 * absence always means "live"). Fixed so it survives scrolling; painted
 * from the store's own theme tokens so it renders on any palette; never
 * dismissible — a preview must stay labeled for its whole lifetime.
 */
export function PreviewBanner({ version }: { version: number }) {
  return (
    <div
      data-testid="preview-banner"
      role="status"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        fontSize: "0.8125rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        backgroundColor: "var(--color-primary)",
        color: "var(--color-background)",
        borderTop: "1px solid var(--color-border, transparent)",
      }}
    >
      Preview — not published (version {version}). Visitors do not see this.
    </div>
  );
}
