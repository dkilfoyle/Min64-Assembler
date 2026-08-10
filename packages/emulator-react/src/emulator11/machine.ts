import type { RunTypes } from "../api";
import { Flags } from "./flags";
import { IODevice } from "./io";
import { Memory } from "./memory";
import { ProgramCounter } from "./programCounter";
import { Register8 } from "./register";
import { CPU } from "./cpu";

export interface IEmulationState {
  pc: number;
  sp: number;
  a: number;
  flags: number;
  // pixelData: Uint8ClampedArray<ArrayBuffer>;
  memory: Uint8Array;
}

export class Machine {
  cpu: CPU;
  memory: Memory;
  a: Register8;
  pc: ProgramCounter;
  flags: Flags;
  uart: IODevice;
  ps2: IODevice;
  totalClocks: number;

  constructor() {
    this.memory = new Memory();
    this.a = new Register8();
    this.pc = new ProgramCounter();
    this.flags = new Flags();
    this.uart = new IODevice(264);
    this.ps2 = new IODevice(5400);
    this.cpu = new CPU(this);
    this.totalClocks = 0;
  }

  async reset() {
    await this.memory.reset();
    this.a.reset();
    this.pc.reset();
    this.flags.reset();
    this.uart.reset();
    this.ps2.reset();
    this.totalClocks = 0;
  }

  isBreakpoint(addr: number) {
    // return this.memory.readByte(addr) == 0x69; // RTS
    return false;
  }

  run(runType: RunTypes, dt: number) {
    let haveClocks = dt * 8000; // 8MHz clock
    switch (runType) {
      case "run":
        while (haveClocks > 0) {
          haveClocks -= this.step();
        }
        break;
      case "debugRun":
        while (haveClocks > 0 && !this.isBreakpoint(this.pc.read())) {
          haveClocks -= this.step();
        }
        break;
      case "stepInto":
        this.step();
        break;
      case "stepOver":
        throw Error("stepOver not implemented");
      case "stepOut":
        throw Error("stepOut not implemented");
      case "stop":
        // do nothing
        break;
      case "reset":
        this.reset();
        break;
    }
  }

  step() {
    const cycles = this.cpu.execute();
    this.totalClocks = (this.totalClocks + cycles) & 0xffffffff;
    this.uart.waited(cycles);
    this.ps2.waited(cycles);
    return cycles;
  }

  stepOver() {
    // JPS 0x67
    // JAS 0x68
    // RTS 0x69
    let steps = 0;
    let level = 1;
    let opcode = this.memory.readByte(this.pc.read());
    if (!(opcode == 0x67 || opcode == 0x68)) throw Error();
    while (!(opcode == 0x69 && level == 0)) {
      this.step();
      opcode = this.memory.readByte(this.pc.read());
      if (opcode == 0x67 || opcode == 0x68) level++;
      if (opcode == 0x69) level--;
      steps++;
    }
    this.step(); // process the RTS

    console.log(`Ran ${steps} steps`);
  }

  getEmulationState(): IEmulationState {
    const pc = this.pc.read();
    const flags = this.flags.read();
    // const opcode = this.memory.readByte(pc);
    // const info = instructionInfo[opcode];

    // const operands = info.operands.map((operand) => ({
    //   type: operand.type,
    //   size: operand.size,
    //   addrStart: pc + operand.pcOffset,
    //   value: operand.size == 2 ? cpu.memory.readWord(pc + operand.pcOffset) : cpu.memory.readByte(pc + operand.pcOffset),
    // }));

    return {
      // totalClocks: this.totalClocks,
      pc,
      sp: 0xff00 + this.memory.readByte(0xff),
      a: this.a.read(),
      flags,
      // flagState: { C: flags & FLAG_C, N: flags & FLAG_N, Z: flags & FLAG_Z },
      // opcode: this.memory.readByte(pc),
      // operands,
      memory: this.memory.ram,
      // pixelData: this.memory.getVRAMImage(),
    };
  }
}

export const machine = new Machine();
