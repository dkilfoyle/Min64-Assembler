export function hexByte(n: number): string {
  // return `$${(n & 0xff).toString(16).padStart(2, "0").toUpperCase()}`;
  return `0x${(n & 0xff).toString(16).padStart(2, "0").toUpperCase()}`;
}
export function hexWord(n: number): string {
  // return `$${(n & 0xffff).toString(16).padStart(4, "0").toUpperCase()}`;
  return `0x${(n & 0xffff).toString(16).padStart(4, "0").toUpperCase()}`;
}
export function immByte(v: number): string {
  // return `#${hex2(v)}`;
  return `${hexByte(v)}`;
}
export function immWord(v: number): string {
  // return `#${hex4(v)}`;
  return `${hexWord(v)}`;
}

/** A zero-page location, either one of our own numeric temps/vars, or an
 *  external symbolic label (e.g. a MUL16 ABI slot). */
export type Addr = number | string;

export function lowOperand(a: Addr): string {
  return typeof a === "number" ? hexByte(a) : `${a}`;
}
export function highOperand(a: Addr): string {
  return typeof a === "number" ? hexByte(a + 1) : `${a}+1`;
}
