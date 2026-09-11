/**
 * Result<T> — the fallible-operation type. Errors don't cross module
 * boundaries as throws, and — the founding rule — an error is never
 * laundered into an empty success. `unknown` and `absent` are different
 * shapes here by construction.
 */
export type Result<T, E = PlatformError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface PlatformError {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends PlatformError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function fail(code: string, message: string, cause?: unknown): Result<never> {
  return { ok: false, error: cause === undefined ? { code, message } : { code, message, cause } };
}
