/**
 * Compile-time-only string branding. At runtime a Branded<'X'> is a plain
 * string; the unique symbol below never exists in emitted code.
 * Mirrors packages/util/brand in the real repo.
 */
declare const BRAND: unique symbol

export type Branded<B extends string> = string & { readonly [BRAND]: B }
