import { RUO_DISCLAIMER } from "@dscodotco/storefront-sections";

/**
 * The RUO (research-use-only) checkout acknowledgment — the affirmation a
 * shopper makes at checkout that the products are for research use only. This
 * is a SERVER-ENFORCED compliance gate (mirrors the age gate's anti-bypass
 * mechanism): the client checkbox is UX only; `/api/ruo-ack` sets the httpOnly
 * `fd_ruo_ok` pass cookie and `/api/checkout` refuses without it.
 *
 * Unlike the age gate (a per-store toggle), the RUO acknowledgment is a
 * NON-REMOVABLE compliance surface — the sibling of `RUO_DISCLAIMER`, which is
 * hardcoded and rendered unconditionally. So this gate is always-on, not
 * manifest-configurable, and closes the bypass for EVERY store.
 */

/**
 * The versioned disclosure the affirmation is bound to, persisted verbatim as
 * `persons.consent_records.disclosure_ref`. Bump the suffix when the affirmed
 * text (`RUO_ACK_STATEMENT` / `RUO_DISCLAIMER`) changes, so each stored consent
 * row records EXACTLY which disclosure the shopper affirmed.
 */
export const RUO_ACK_DISCLOSURE_REF = "ruo-ack-v1";

/**
 * The affirmation statement shown next to the checkout checkbox. The canonical
 * legal text is `RUO_DISCLAIMER`; this is the first-person confirmation of it.
 */
export const RUO_ACK_STATEMENT =
  "I confirm these products are for research use only and will not be used for human or veterinary consumption.";

/** The full disclosure text a stored `RUO_ACK_DISCLOSURE_REF` resolves to. */
export const RUO_ACK_DISCLOSURE_TEXT = `${RUO_ACK_STATEMENT} ${RUO_DISCLAIMER}`;

/** The consent categories a placed order's RUO affirmation grants (append-only row). */
export function ruoAckCategories(): Record<string, boolean> {
  return { researchUseOnly: true };
}
