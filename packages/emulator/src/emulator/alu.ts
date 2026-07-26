import { FLAG_C, FLAG_N, FLAG_Z } from "./flags";

const mask = {
  1: 0xff,
  2: 0xffff,
  4: 0xffffffff,
};

const msbmask = {
  1: 0xff,
  2: 0xff00,
  4: 0xff000000,
};

const msbshift = {
  1: 0,
  2: 8,
  4: 24,
};

const negativebit = {
  1: 1 << 7,
  2: 1 << 15,
  4: 1 << 31,
};

const overflowbit = {
  1: 1 << 8,
  2: 1 << 16,
  4: 1 << 32,
};

type IBytes = 1 | 2 | 4;
export const BYTE: IBytes = 1;
export const WORD: IBytes = 2;
export const LONG: IBytes = 4;

export const add = (size: IBytes, x: number, y: number, c = 0) => {
  const res = x + y + c;
  const msb = res >>> msbshift[size];
  let flags = 0;
  if (msb > 0xff) flags |= FLAG_C;
  if ((msb & 0xff) == 0) flags |= FLAG_Z;
  if (msb & 0x80) flags |= FLAG_N;
  return { a: msb & 0xff, res: res & mask[size], flags };
};

export const sub = (size: IBytes, x: number, y: number, c = 1) => {
  const res = x - y - 1 + c;
  const msb = res >> msbshift[size];
  let flags = 0;
  if ((msb & 0xffffff00) == 0) flags |= FLAG_C;
  if ((msb & 0xff) == 0) flags |= FLAG_Z;
  if (msb & 0x80) flags |= FLAG_N;
  return { a: msb & 0xff, res: res & mask[size], flags };
};

export const and = (size: IBytes, x: number, y: number) => {
  if (size != BYTE) throw Error("bitwise AND only bytes");
  if (x > 0xff || y > 0xff) throw Error("bitwise AND only bytes");
  const res = x & y;
  return { a: res, res, flags: null };
};

export const or = (size: IBytes, x: number, y: number) => {
  if (size != BYTE) throw Error("bitwise OR only bytes");
  if (x > 0xff || y > 0xff) throw Error("bitwise OR only bytes");
  const res = x | y;
  return { a: res, res: res, flags: null };
};

export const xor = (size: IBytes, x: number, y: number) => {
  if (size != BYTE) throw Error("bitwise XOR only bytes");
  if (x > 0xff || y > 0xff) throw Error("bitwise XOR only bytes");
  const res = x ^ y;
  return { a: res, res: res, flags: null };
};

export const not = (size: IBytes, x: number) => {
  const res = ~x;
  return { a: res & mask[size], res, flags: null };
};

export const neg = (size: IBytes, x: number) => {
  const res = (-x >>> 0) & mask[size]; //~x + 1;
  const msb = (res >> msbshift[size]) & 0xff;
  let flags = 0;
  if (msb & 0x80) flags |= FLAG_N;
  if (res == 0) flags |= FLAG_C;
  if (msb == 0) flags |= FLAG_Z;
  return { a: msb & 0xff, res: res & mask[size], flags };
};

export const shiftLeft = (size: IBytes, x: number, n: number) => {
  const res = x << n;
  let flags = 0;
  const msb = res >> msbshift[size];
  if (msb & 0x80) flags |= FLAG_N;
  if (msb & 0x100) flags |= FLAG_C;
  if ((msb & 0xff) == 0) flags |= FLAG_Z;
  return { a: msb & 0xff, res: res & mask[size], flags };
};

export const shiftRight = (size: IBytes, x: number, n: number) => {
  if (size != BYTE) throw Error("Shift right only bytes");
  const xmsb = x >> msbshift[size];
  const carry = xmsb & (1 << (n - 1));
  const res = x >> n;
  const msb = res >> msbshift[size];
  let flags = 0;
  if (carry) flags |= FLAG_C;
  if ((msb & 0xff) == 0) flags |= FLAG_Z;
  // leftmost bit will be 0 so can't be negative
  return { a: msb & 0xff, res: res & mask[size], flags };
};

export const rotateLeft = (size: IBytes, x: number, n: number, c = 0) => {
  let res = x & mask[size];
  for (let i = 0; i < n; i++) {
    res = res << 1;
    if (c) res |= 1;
    c = (res & overflowbit[size]) != 0 ? 1 : 0;
    res = res & mask[size];
  }

  const msb = (res >> msbshift[size]) & 0xff;

  let flags = 0;
  if (c != 0) flags |= FLAG_C;
  if (msb == 0) flags |= FLAG_Z;
  if (msb & 0x80) flags |= FLAG_N;
  return { a: res, res, flags };
};

export const rotateRight = (size: IBytes, x: number, n = 1, c = 0) => {
  if (n != 1) throw Error("rotateRight by only 1");
  if (size != BYTE) throw Error("Only rotate bytes");

  let res = x & 0xff;
  if (c) res |= 0x100;
  c = res & 1;
  res = (res >> 1) & 0xff;

  let flags = 0;
  if (c) flags |= FLAG_C;
  if (res == 0) flags |= FLAG_Z;
  if (res & 0x80) flags |= FLAG_N;
  return { a: res, res, flags };
};

export const inc = (size: IBytes, x: number) => {
  const res = x + 1;
  const msb = res >>> msbshift[size];
  let flags = 0;
  if (msb & 0x80) flags |= FLAG_N;
  if (msb > 0xff) flags |= FLAG_C;
  if ((msb & 0xff) == 0) flags |= FLAG_Z;
  return { a: msb & 0xff, res: res & mask[size], flags };
};

export const dec = (size: IBytes, x: number) => {
  // sets carry if not -1
  // if -1 (0xff or 0xffff or 0xfffff) then we have a borrow = !carry
  const res = (x - 1) & mask[size];
  let flags = 0;
  if (res != mask[size]) flags |= FLAG_C; // set carry unless -1
  if ((res & msbmask[size]) == 0) flags |= FLAG_Z;
  if (res & negativebit[size]) flags |= FLAG_N;
  return { a: (res >>> msbshift[size]) & 0xff, res: res & mask[size], flags };
};
