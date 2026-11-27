import { machine } from "./machine";
import { MemoryMappedIO } from "./memory";

export class MinCpuTimer extends MemoryMappedIO {
  public latch: bigint = 0n;
  public start: bigint = 0n;
  reset() {
    this.latch = 0n;
    this.start = 0n;
  }
  read(address: number): number | undefined {
    switch (address) {
      case 0xfe28:
        return Number(this.latch & 0xffn);
      case 0xfe29:
        return Number(this.latch >> 8n) & 0xff;
      case 0xfe2a:
        return Number(this.latch >> 16n) & 0xff;
      case 0xfe2b:
        return Number(this.latch >> 24n) & 0xff;
      case 0xfe2c:
        return Number(this.latch >> 32n) & 0xff;
      case 0xfe2d:
        return Number(this.latch >> 40n) & 0xff;
    }
    return undefined;
  }
  write(address: number, value: number): boolean {
    if (address == 0xfe2f) {
      // reset timer
      this.start = BigInt(machine.cpu.cyclesExecuted);
      return true;
    } else if (address == 0xfe2e) {
      // latch current timer value
      this.latch = BigInt(machine.cpu.cyclesExecuted) - this.start;
      console.log(`Latched timer value: ${this.latch}`);
      return true;
    } else return false;
  }
}
