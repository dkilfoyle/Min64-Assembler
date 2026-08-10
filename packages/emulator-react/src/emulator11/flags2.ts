import { Register8 } from "./register";

export const FLAG_Z = 1;
export const FLAG_C = 2;
export const FLAG_N = 4;

export class Flags2 extends Register8 {
  setC() {
    this.value |= FLAG_C;
  }
  unsetC() {
    this.value &= ~FLAG_C;
  }
  z() {
    return this.value & FLAG_Z ? 1 : 0;
  }
  c() {
    return this.value & FLAG_C ? 1 : 0;
  }
  n() {
    return this.value & FLAG_N ? 1 : 0;
  }
  gt() {
    return this.value & FLAG_C && (this.value & FLAG_Z) == 0;
  }
}
