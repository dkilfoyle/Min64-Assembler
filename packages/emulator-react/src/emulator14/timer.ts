import { machine } from "./machine";
import { MemoryMappedIO } from "./memory";

export class MinCpuTimer extends MemoryMappedIO {
  public latch: number = 0;
  public start: number = 0;
  reset() {
    this.latch = 0;
    this.start = 0;
  }
  read(address: number): number | undefined {
    switch (address) {
      case 0xfe28:
        return this.latch & 0xff;
      case 0xfe29:
        return (this.latch >> 8) & 0xff;
      case 0xfe2a:
        return (this.latch >> 16) & 0xff;
      case 0xfe2b:
        return (this.latch >> 24) & 0xff;
      case 0xfe2c:
        return (this.latch >> 32) & 0xff;
      case 0xfe2d:
        return (this.latch >> 40) & 0xff;
    }
    return undefined;
  }
  write(address: number, value: number): boolean {
    if (address == 0xfe2f) {
      // reset timer
      this.start = machine.cpu.cyclesExecuted;
      return true;
    } else if (address == 0xfe2e) {
      // latch current timer value
      this.latch = machine.cpu.cyclesExecuted - this.start;
      return true;
    } else return false;
  }
}
