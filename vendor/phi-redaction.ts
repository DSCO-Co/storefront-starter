/**
 * PHI redaction — the single, shared scrubber for PHI/PII.
 *
 * This is the one canonical redactor for the platform. Any sink that emits
 * data outside the process (structured logs, error trackers, …) should run
 * through it so PHI never reaches stdout / log aggregation. Do NOT fork this
 * into a divergent second redactor.
 *
 * Strategy:
 *   - Key-based: any object key naming PHI (phi/patient) or a known free-text
 *     note field is replaced wholesale.
 *   - Value-based: string values are scanned for PHI-shaped substrings (email,
 *     phone, SSN, DOB, MRN, biomarker values) which are masked in place. This
 *     is what catches PHI embedded in `error.message` / stack strings.
 *   - Operational fields (service, component, correlation_id, status,
 *     durations, event names, numbers, booleans) carry no PHI shape and pass
 *     through untouched.
 */

export const PHI_REDACTED = "[REDACTED_PHI]";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN =
  /(?<![\d.])(?:\+?1[-.\s]?)?(?:\([0-9]{3}\)|[0-9]{3})[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}(?![\d])/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const DOB_PATTERN =
  /\b(?:(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}|(?:19|20)\d{2}[/-](?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(?:19|20)\d{2})\b/gi;
const MRN_PATTERN = /\b(?:mrn|medical record(?: number)?)\s*[:#]?\s*[\w-]+/gi;
const BIOMARKER_VALUE_PATTERN =
  /\b(?:hba1c|a1c|glucose|testosterone|cholesterol|ldl|hdl|triglycerides|tsh|vitamin d|ferritin|creatinine|biomarker(?: value)?)\s*[:=]?\s*[\d.]+\s*(?:%|mg\/dl|ng\/dl|mmol\/l|iu\/l)?/gi;

const STRING_PATTERNS = [
  EMAIL_PATTERN,
  PHONE_PATTERN,
  SSN_PATTERN,
  DOB_PATTERN,
  MRN_PATTERN,
  BIOMARKER_VALUE_PATTERN,
] as const;

const PHI_KEY_PATTERN =
  /(?:^|[_-])(?:phi|patient)(?:$|[_-])|(?:^|[_-])(?:phi|patient)\b|\b(?:phi|patient)(?:$|[_-])/i;

const FREE_TEXT_NOTE_KEYS = new Set([
  "note",
  "notes",
  "clinical_notes",
  "clinical_note",
  "free_text",
  "freetext",
  "chief_complaint",
  "transcript",
  "call_transcript",
  "health_history",
  "intake_notes",
  "message_body",
  "body_text",
]);

/** True when an object key names a PHI field (e.g. patient_id, phi_payload). */
export function isPhiKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (PHI_KEY_PATTERN.test(normalized)) {
    return true;
  }
  return normalized.includes("phi") || normalized.includes("patient");
}

/** True when an object key names a known free-text / clinical note field. */
export function isFreeTextNoteKey(key: string): boolean {
  return FREE_TEXT_NOTE_KEYS.has(key.toLowerCase());
}

/** Mask PHI-shaped substrings (email, phone, SSN, DOB, MRN, biomarker) in a string. */
export function redactPhiPatterns(value: string): string {
  let redacted = value;
  for (const pattern of STRING_PATTERNS) {
    redacted = redacted.replace(pattern, PHI_REDACTED);
  }
  return redacted;
}

/**
 * Recursively scrub PHI from an arbitrary value. PHI-keyed fields are masked
 * wholesale; string values have PHI-shaped substrings masked in place; objects
 * and arrays are walked. Numbers and booleans pass through unchanged.
 *
 * @param value the value to scrub
 * @param key the key `value` was found under, if any (drives key-based masking)
 */
export function scrubPhi(value: unknown, key?: string): unknown {
  if (key !== undefined) {
    if (isPhiKey(key) || isFreeTextNoteKey(key)) {
      return PHI_REDACTED;
    }
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactPhiPatterns(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubPhi(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const scrubbed: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      scrubbed[childKey] = scrubPhi(childValue, childKey);
    }
    return scrubbed;
  }

  return value;
}
