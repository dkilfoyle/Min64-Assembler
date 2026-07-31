export class Register8 {
  protected value: number = 0;
  read() {
    return this.value;
  }
  write(val: number) {
    this.value = val & 0xff; // Ensure it's an 8-bit value
  }
  reset() {
    this.value = 0;
  }
}

export class Register16 {
  protected value: number = 0;
  read() {
    return this.value;
  }
  write(val: number) {
    if (this.value > 0xffff) debugger;
    this.value = val & 0xffff; // Ensure it's an 16-bit value
  }
  reset() {
    this.value = 0;
  }
}
