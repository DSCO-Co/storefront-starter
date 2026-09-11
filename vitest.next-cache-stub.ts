// Test stub for `next/cache`: unstable_cache becomes a pass-through so cached
// data helpers are unit-testable without the Next runtime.
type AnyAsyncFn = (...args: never[]) => Promise<unknown>;

export function unstable_cache<F extends AnyAsyncFn>(fn: F, _keys?: string[], _opts?: unknown): F {
  return fn;
}

export function revalidateTag(_tag: string): void {}
