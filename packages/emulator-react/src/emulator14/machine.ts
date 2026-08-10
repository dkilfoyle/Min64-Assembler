import { Memory, BANK_SIZE } from "./memory";
import { IoDevices } from "./io";
import { CPU } from "./cpu";
import { Vga } from "./vga";
import { parseIntelHex, applyHexRecords } from "./intelHex";
import type { RunTypes, StepTypes } from "../api";
import { disassembleOne, disassembleRange } from "./disassembler";
import { osAddressToLabel } from "./oslabels";

export interface IEmulationState {
  pc: number;
  sp: number;
  a: number;
  n: boolean;
  z: boolean;
  c: boolean;
  memory: Uint8Array;
}

interface ICallStackEntry {
  callAddress: number;
  targetAddress: number;
  returnAddressStackPosition: number;
}

interface IBreakpoint {
  pc?: number;
  stackPtr?: number;
  onceOnly: boolean;
}

export class Machine {
  readonly mem = new Memory();
  readonly io = new IoDevices();
  readonly cpu = new CPU(this.mem, this.io);
  readonly vga = new Vga(this.mem);
  isTracing = false;
  runType: RunTypes | StepTypes = "run";
  // callStack: ICallStackEntry[] = [];
  breakpoints: IBreakpoint[] = [];
  stopStepOverPC = -1;

  /** Resets the CPU (PC=0, BANK=0) and clears pending I/O, ready to boot from FLASH bank 0. */
  async reset() {
    await this.mem.reset();
    this.cpu.reset();
    this.io.reset();
    this.runType = "run";
    this.stopStepOverPC = -1;
    // this.callStack = [];
  }

  /**
   * Loads a raw 512KB (or smaller) SSD FLASH image, e.g. the binary FLASH images
   * distributed alongside the Minimal 64x4 GitHub repo, starting at a given bank.
   */
  loadFlashImage(bytes: Uint8Array, startBank = 0): void {
    this.mem.loadFlashImage(bytes, startBank);
  }

  /**
   * Parses an Intel HEX file (as produced by the cross/native assembler) and writes its
   * contents into FLASH starting at `startBank` (bank-relative addressing: HEX record
   * addresses are treated modulo 0x1000 within consecutive 4KB banks starting at
   * `startBank`, matching how 'asm os.asm' output is burned into FLASH banks 0-2).
   */
  loadHexIntoFlash(hexText: string, startBank = 0): void {
    const records = parseIntelHex(hexText);
    for (const rec of records) {
      const flatAddr = startBank * BANK_SIZE + rec.address;
      if (flatAddr < 0 || flatAddr + rec.data.length > this.mem.flash.length) continue;
      this.mem.flash.set(rec.data, flatAddr);
    }
  }

  /**
   * Parses an Intel HEX file and writes its contents directly into RAM at the record's
   * address (used e.g. for the 'receive' command's in-RAM OS update path, or for loading
   * a user program assembled to run from RAM).
   */
  loadHexIntoRam(hexText: string): number {
    const records = parseIntelHex(hexText);
    return applyHexRecords(this.mem.ram, records, 0);
  }

  isBreakpoint(addr: number) {
    const hit = this.breakpoints.findIndex((bp) => {
      if (bp.pc) return bp.pc == addr;
      if (bp.stackPtr) {
        const hi = this.mem.read(0xff00 + bp.stackPtr);
        const lo = this.mem.read(0xff00 + bp.stackPtr + 1);
        const retAddr = ((lo | (hi << 8)) + 2) & 0xffff;
        return retAddr === addr;
      }
    });
    if (hit !== -1 && this.breakpoints[hit].onceOnly) {
      this.breakpoints.splice(hit, 1);
    }
    return hit !== -1;
  }

  debugLog() {
    const indent = this.cpu.level > 0 ? "  ".repeat(this.cpu.level) : "";
    const msg = (x: string) => console.log(indent + x);
    const lbl = osAddressToLabel[this.cpu.pc];
    switch (lbl) {
      case "OS_Start":
      case "OS_ClearVRAM":
      case "OS_LoadFile":
      case "OS_FindFile":
      case "OS_FlashA":
      case "OS_Splash":
      case "OS_Update":
      case "OS_Logo":
      case "OS_SerialPrint":
      case "OS_Print":
      case "OS_PrintChar":
      case "OS_Char":
      case "OS_Prompt":
      case "OS_ReadLine":
      case "OS_SkipSpace":
        msg(lbl);
    }

    // this.isTracing = this.cpu.pc >= 0xf7e1 && this.cpu.pc <= 0xf7ff; // OS_SerialPrint
    // if (lbl === "OS_Splash") this.isTracing = true;

    // if (lbl == "OS_Char") debugger;
    // if (this.cpu.pc == 0xf7df + 2) debugger;

    if (this.isTracing) {
      msg(`${this.cpu.pc.toString(16).padStart(4, "0")}: ${disassembleOne(this.mem, this.cpu.pc).text}`);
      // console.log(disassembleRange(this.mem, 0xf4a5, 20));
    }
  }

  /** Delivers a byte as if typed on the PS/2 keyboard (MinOS scan-code convention). */
  pushKey(byte: number): void {
    this.io.pushKeyByte(byte);
  }

  /** Delivers a byte as if received over the UART (e.g. a host terminal keystroke). */
  pushUartByte(byte: number): void {
    this.io.pushUartByte(byte);
  }

  debugStep() {
    // if (this.isTracing) this.debugLog();
    return this.cpu.step();
    // if (this.isTracing) {
    //   console.log(
    //     `A=${this.cpu.a.toString(16).padStart(2, "0")} N=${this.cpu.n ? 1 : 0} Z=${this.cpu.z ? 1 : 0} C=${this.cpu.c ? 1 : 0}`,
    //   );
    // }
  }

  frame(dt: number) {
    // run 1 frame of emulation, consuming up to 8MHz * dt milliseconds of CPU time = up to 133,333 cycles
    // or until a breakpoint is hit or the runType changes to "stop"
    // this.mem.frame();
    let haveClocks = dt * 8000; // 8MHz clock
    switch (this.runType) {
      case "run":
        while (haveClocks > 0) {
          haveClocks -= this.cpu.step();
        }
        break;
      case "continue":
        let isTimeToStop = this.isBreakpoint(this.cpu.pc) || this.cpu.pc == this.stopStepOverPC || this.cpu.pc == 0xf135; // 0xf135 is OS_Prompt, which is a good place to stop after a continue
        while (haveClocks > 0 && !isTimeToStop) {
          haveClocks -= this.debugStep();
          isTimeToStop = this.isBreakpoint(this.cpu.pc) || this.cpu.pc === this.stopStepOverPC || this.cpu.pc == 0xf135;
        }
        if (isTimeToStop) {
          this.runType = "stop";
          this.stopStepOverPC = -1;
        }
        break;
      case "stepInto":
        this.debugStep();
        this.runType = "stop";
        break;
      case "stepOver":
        const opcode = this.mem.read(this.cpu.pc);
        if (opcode === 0x69 || opcode === 0x6a) {
          this.runType = "continue";
        } else this.runType = "stepInto";
        break;
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

  getEmulationState(): IEmulationState {
    return {
      pc: this.cpu.pc,
      sp: this.mem.read(0xffff),
      a: this.cpu.a,
      n: this.cpu.n,
      z: this.cpu.z,
      c: this.cpu.c,
      memory: this.mem.ram,
    };
  }
}

export const machine = new Machine();
