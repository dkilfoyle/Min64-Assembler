import { Register16 } from "./register";

export class ProgramCounter extends Register16 {
  inc(): void {
    this.value++;
    if (this.value > 0xffff) debugger;
  }
  dec(): void {
    this.value--;
    if (this.value < 0) debugger;
  }
}
