import { Register8 } from "./register";

export const FLAG_Z = 1;
export const FLAG_C = 2;
export const FLAG_N = 4;

export class Flags extends Register8 {
  updateZN(a: number) {
    this.value = (this.value & ~(FLAG_Z | FLAG_N)) | (a == 0 ? FLAG_Z : 0) | (a & 0x80 ? FLAG_N : 0);
  }
  updateC(a: number, isAdd: boolean) {
    // when adding set carry if a > 255 OR a < 0
    // when subing set carry if a is 0-255
    this.value = ((a & 0xffffff00) != 0) !== isAdd ? this.value & ~FLAG_C : this.value | FLAG_C;
  }
  update(a: number, isAdd: boolean) {
    this.updateC(a, isAdd);
    this.updateZN(a);
  }
  updateCLikeZ() {
    // replace c with current z, leave z and n unchanged
    const c = (this.value & FLAG_Z) << 1;
    this.value = (this.value & 5) | c;
  }
  setC(cs: boolean) {
    if (cs) this.value |= FLAG_C;
    else this.value &= ~FLAG_C;
  }
  setN(ns: boolean) {
    if (ns) this.value |= FLAG_N;
    else this.value &= ~FLAG_N;
  }
  setZ(zs: boolean) {
    if (zs) this.value |= FLAG_Z;
    else this.value &= ~FLAG_Z;
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
    // dec has a carry until -1
    return this.c() && this.z() == 0;
  }
}
