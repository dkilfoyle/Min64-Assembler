import * as Alu from "./alu";
import { BYTE } from "./alu";
import { FLAG_C, FLAG_N, FLAG_Z, Flags } from "./flags";
import { instructionInfo } from "./instructions";
import { IODevice } from "./io";
import { Memory } from "./memory";
import { ProgramCounter } from "./programCounter";
import { Register8 } from "./register";
import { labelToAddress } from "./symbols";

export const SIZE_BYTE = 1;
export const SIZE_WORD = 2;
export const SIZE_LONG = 4;

interface IOperandInfo {
  value: number;
  type: string;
  size: number;
  addrStart: number;
}

type IMode = "I" | "Z" | "T" | "B" | "R" | "V" | "W" | "Q" | "L";
const ZBVWQL: IMode[] = ["Z", "B", "V", "W", "Q", "L"];
const ZBTRVWQL: IMode[] = ["Z", "B", "T", "R", "V", "W", "Q", "L"];
const IZBTR: IMode[] = ["I", "Z", "B", "T", "R"];

export interface IEmulationState {
  pc: number;
  sp: number;
  a: number;
  flags: number;
  // flagState: { C: number; N: number; Z: number };
  // opcode: number;
  // operands: IOperandInfo[];
  // pixelData: Uint8ClampedArray<ArrayBuffer>;
  memory: Uint8Array;
  // totalClocks: number;
}

class CPU {
  public memory = new Memory();
  public a = new Register8();
  public pc = new ProgramCounter();
  public flags = new Flags();
  public uart = new IODevice(264);
  public ps2 = new IODevice(5400);
  public totalClocks = 0;

  modeFn(mode: IMode) {
    switch (mode) {
      case "I": {
        return {
          read: this.readImm8,
          write: () => {
            throw Error("Can't write with immediate mode");
          },
          size: Alu.BYTE,
        };
      }
      case "Z":
        return {
          read: this.readStarZ,
          write: this.memory.writeByte,
          size: Alu.BYTE,
        };
      case "T":
        return {
          read: this.readStarStarZ,
          write: this.memory.writeByte,
          size: Alu.BYTE,
        };
      case "B":
        return {
          read: this.readStarB,
          write: this.memory.writeByte,
          size: Alu.BYTE,
        };
      case "R":
        return {
          read: this.readStarStarB,
          write: this.memory.writeByte,
          size: Alu.BYTE,
        };
      case "V":
        return {
          read: this.readStarV,
          write: this.memory.writeWord,
          size: Alu.WORD,
        };
      case "W":
        return {
          read: this.readStarW,
          write: this.memory.writeWord,
          size: Alu.WORD,
        };
      case "Q":
        return {
          read: this.readStarQ,
          write: this.memory.writeLong,
          size: Alu.LONG,
        };
      case "L":
        return {
          read: this.readStarL,
          write: this.memory.writeLong,
          size: Alu.LONG,
        };
    }
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

  readByteFromPC = () => {
    const byte = this.memory.readByte(this.pc.read());
    this.pc.inc();
    return byte;
  };

  readWordFromPC = () => {
    const low = this.readByteFromPC();
    const high = this.readByteFromPC();
    return (high << 8) | low;
  };

  readImm8 = () => {
    return { addr: 0, val: this.readByteFromPC() };
  };

  readImm16() {
    return this.readWordFromPC();
  }

  // Z is zero-page byte

  readStarZ = () => {
    const addr = this.readByteFromPC();
    const val = this.memory.readByte(addr);
    return { addr, val };
  };

  readStarStarZ = () => {
    const addr = this.memory.readWord(this.readByteFromPC());
    const val = this.memory.readByte(addr);
    return { addr, val };
  };

  // V is zero-page word

  readStarV = () => {
    const addr = this.readByteFromPC();
    const val = this.memory.readWord(addr);
    return { addr, val };
  };

  readStarStarV = () => {
    const addr = this.memory.readWord(this.readByteFromPC());
    const val = this.memory.readWord(addr);
    return { addr, val };
  };

  // Q is zero-page long

  readStarQ = () => {
    const addr = this.readByteFromPC();
    const val = this.memory.readLong(addr);
    return { addr, val };
  };

  readStarStarQ = () => {
    const addr = this.memory.readWord(this.readByteFromPC());
    const val = this.memory.readLong(addr);
    return { addr, val };
  };

  // B is non-zero memory byte

  readStarB = () => {
    const addr = this.readWordFromPC();
    const val = this.memory.readByte(addr);
    return { addr, val };
  };

  readStarStarB = () => {
    const addr = this.memory.readWord(this.readWordFromPC());
    const val = this.memory.readByte(addr);
    return { addr, val };
  };

  // W is non-zero memory word

  readStarW = () => {
    const addr = this.readWordFromPC();
    const val = this.memory.readWord(addr);
    return { addr, val };
  };

  readStarStarW = () => {
    const addr = this.memory.readWord(this.readWordFromPC());
    const val = this.memory.readWord(addr);
    return { addr, val };
  };

  // L is non-zero memory long

  readStarL = () => {
    const addr = this.readWordFromPC();
    const val = this.memory.readLong(addr);
    return { addr, val };
  };

  readStarStarL = () => {
    const addr = this.memory.readWord(this.readWordFromPC());
    const val = this.memory.readLong(addr);
    return { addr, val };
  };

  step() {
    // Fetch instruction
    const opcode = this.memory.readByte(this.pc.read());
    this.pc.inc();
    // Decode and execute instruction
    switch (opcode) {
      case 0: // NOP
        break;
      case 0x01: {
        // OUT: Write byte from A to UART: UART.write(A)
        this.flags.write(4);
        break;
      }
      case 0x02: {
        // INT: Read byte from UART into A: A = UART.read()
        const data = this.uart.read();
        this.a.write(data);
        break;
      }
      case 0x03: // INK: Read PS/2 input to A: A = PS2
        {
          const ps2in = this.ps2.read();
          this.a.write(ps2in);
        }
        break;
      case 0x04: // WIN: Wait for input
        if (!(this.uart.hasData() || this.ps2.hasData())) this.pc.dec();
        // else {
        //   console.log("ps2.data = ", this.ps2.toString());
        // }
        break;

      case 0x05: // SEC	Set carry flag (C=1)
        this.flags.write(FLAG_C);
        break;

      case 0x06: // CLC	Clear carry flag (C=0)
        this.flags.write(FLAG_N);
        break;

      case 0x07: // LL0	Logical left-shift A 0 steps (C=0)
        {
          // nothing
        }
        break;
      case 0x08: // LL1	Logical left-shift A 1 steps (C=0)
      case 0x09: // LL2	Logical left-shift A 2 steps (C=0)
      case 0x0a: // LL3	Logical left-shift A 3 steps (C=0)
      case 0x0b: // LL4	Logical left-shift A 4 steps (C=0)
      case 0x0c: // LL5	Logical left-shift A 5 steps (C=0)
      case 0x0d: // LL6	Logical left-shift A 6 steps (C=0)
      case 0x0e: // LL7	Logical left-shift A 7 steps (C=0)
        {
          const { a, flags } = Alu.shiftLeft(BYTE, this.a.read(), opcode - 0x07);
          this.a.write(a);
          this.flags.write(flags);
        }
        break;

      case 0x0f: // RL0	Rotate left A 0 steps via C (= RR9)
        {
          //does nothing
        }
        break;
      case 0x10: // RL1	Rotate left A 1 steps via C (= RR8)
      case 0x11: // RL2	Rotate left A 2 steps via C (= RR7)
      case 0x12: // RL3	Rotate left A 3 steps via C (= RR6)
      case 0x13: // RL4	Rotate left A 4 steps via C (= RR5)
      case 0x14: // RL5	Rotate left A 5 steps via C (= RR4)
      case 0x15: // RL6	Rotate left A 6 steps via C (= RR3)
      case 0x16: // RL7	Rotate left A 7 steps via C (= RR2)
        {
          const { a, flags } = Alu.rotateLeft(BYTE, this.a.read(), opcode - 0x0f, this.flags.c());
          this.a.write(a);
          this.flags.write(flags);
        }
        break;

      case 0x17: // RR1	Rotate right A 1 step via C (= RL8)
        {
          const { a, flags } = Alu.rotateRight(BYTE, this.a.read(), 1, this.flags.c());
          this.a.write(a);
          this.flags.write(flags);
        }
        break;

      case 0x18: // LR0	Logical right-shift A 0 steps (C=0)
        {
          // does nothing
        }
        break;
      case 0x19: // LR1	Logical right-shift A 1 steps (C=0)
      case 0x1a: // LR2	Logical right-shift A 2 steps (C=0)
      case 0x1b: // LR3	Logical right-shift A 3 steps (C=0)
      case 0x1c: // LR4	Logical right-shift A 4 steps (C=0)
      case 0x1d: // LR5	Logical right-shift A 5 steps (C=0)
      case 0x1e: // LR6	Logical right-shift A 6 steps (C=0)
      case 0x1f: // LR7	Logical right-shift A 7 steps (C=0)
        {
          const { a, flags } = Alu.shiftRight(BYTE, this.a.read(), opcode - 0x18);
          this.a.write(a);
          this.flags.write(flags);
        }
        break;

      case 0x20: // LLZ	Logical shift left *Z 1 step (C=0)
      case 0x21: // LLB	Logical shift byte *addr left 1 step (C=0)
      case 0x22: // LLV	Logical shift fast word left 1 step (C=0)
      case 0x23: // LLW	Logical shift word left 1 step (C=0)
      case 0x24: // LLQ	Logical shift fast long *Q left 1 step (C=0)
      case 0x25: // LLL	Logical shift long left 1 step (C=0)
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x20]);
          const { addr, val } = read();
          const { a, res, flags } = Alu.shiftLeft(size, val, 1);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0x26: //	LRZ	Logical shift right zero-page byte 1 step (C=0)
      case 0x27: //	LRB	Logical shift right abs byte 1 step (C=0)
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x26]);
          const { addr, val } = read();
          const { a, res, flags } = Alu.shiftRight(size, val, 1);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0x28: //	RLZ	Rotate left zero-page byte 1 step via C
      case 0x29: //	RLB	Rotate left byte at abs addr 1 step via C
      case 0x2a: //	RLV	Rotate left zero-page word 1 step via C
      case 0x2b: //	RLW	Rotate left word at abs addr 1 step via C
      case 0x2c: //	RLQ	Rotate left zero-page long 1 step via C
      case 0x2d: //	RLL	Rotate left abs long 1 step via C
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x28]);
          const { addr, val } = read();
          const { a, res, flags } = Alu.rotateLeft(size, val, 1, this.flags.c());
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0x2e: //	RRZ	Rotate right zero-page byte 1 step via C
      case 0x2f: //	RRB	Rotate right byte at abs addr 1 step via C
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x2e]);
          const { addr, val } = read();
          const { a, res, flags } = Alu.rotateRight(size, val, 1, this.flags.c());
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0x30: {
        // NOT	Bitwise NOT A: A = ~A
        this.a.write(~this.a.read());
        break;
      }
      case 0x31: // NOZ	Bitwise NOT *Z: *Z = ~(*Z)
      case 0x32: // NOB	Bitwise NOT byte: *addr = ~(*addr)
      case 0x33: // NOV	Bitwise NOT zero-page word: *V = ~(*V)
      case 0x34: // NOW	Bitwise NOT word at abs address
      case 0x35: // NOQ	Bitwise NOT zero-page long
      case 0x36: // NOL	Bitwise NOT long at abs address
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x31]);
          const { addr, val } = read();
          const { a, res } = Alu.not(size, val);
          this.a.write(a);
          write(addr, res);
        }
        break;

      case 0x37: {
        // NEG Negate A: A = -A
        const { a, flags } = Alu.neg(BYTE, this.a.read());
        this.a.write(a);
        this.flags.write(flags); // TODO test proper C flag
        break;
      }

      case 0x38: // NEZ	Negate zero-page byte: *Z = -(*Z)
      case 0x39: // NEB	Negate byte at abs address: *addr = -(*addr)
      case 0x3a: // NEV	Negate zero-page word (C = 1 only if word=0)
      case 0x3b: // NEW	Negate word at abs address (C = 1 only if word=0)
      case 0x3c: // NEQ	Negate zero-page long (C = 1 only if long = 0)
      case 0x3d: // NEL	Negate long (C = 1 only if long = 0)
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x38]);
          const { addr, val } = read();
          const { a, res, flags } = Alu.neg(size, val);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
          // TODO test me especially C
        }
        break;

      case 0x3e: // ANI	Bitwise AND: A = A & imm
      case 0x3f: // ANZ	Bitwise AND: A = A & *Z
      case 0x40: // ANB	Bitwise AND: A = A & *addr
      case 0x41: // ANT	Bitwise AND: A = A & *(*Z)
      case 0x42: // ANR	Bitwise AND: A = A & *(*addr)
        {
          const { val } = this.modeFn(IZBTR[opcode - 0x3e]).read();
          const { a } = Alu.and(BYTE, this.a.read(), val);
          this.a.write(a);
        }
        break;
      case 0x43: // AN.Z	Bitwise AND: *Z = *Z & As
      case 0x44: // AN.B	Bitwise AND: *addr = *addr & As
        {
          const { read, write } = this.modeFn(ZBTRVWQL[opcode - 0x43]);
          const { addr, val } = read();
          const { a, res } = Alu.and(BYTE, this.a.read(), val);
          this.a.write(a);
          write(addr, res);
        }
        break;

      case 0x45: // ORI	Bitwise OR: A = A | imm
      case 0x46: // ORZ	Bitwise OR: A = A | *Z
      case 0x47: // ORB	Bitwise OR: A = A | *addr
      case 0x48: // ORT	Bitwise OR: A = A | *(*Z)
      case 0x49: // ORR	Bitwise OR: A = A | *(*addr)
        {
          const { val } = this.modeFn(IZBTR[opcode - 0x45]).read();
          const { a } = Alu.or(BYTE, this.a.read(), val);
          this.a.write(a);
        }
        break;

      case 0x4a: // OR.Z	Bitwise OR: *Z = *Z | A
      case 0x4b: // OR.B	Bitwise OR: *addr = *addr | A
        {
          const { read, write } = this.modeFn(ZBTRVWQL[opcode - 0x4a]);
          const { addr, val } = read();
          const { a, res } = Alu.or(BYTE, this.a.read(), val);
          this.a.write(a);
          write(addr, res);
        }
        break;

      case 0x4c: // XRI	Bitwise XOR: A = A ^ imm §
      case 0x4d: // XRZ	Bitwise XOR: A = A ^ *Z
      case 0x4e: // XRB	Bitwise XOR: A = A ^ * addr §
      case 0x4f: // XRT	Bitwise XOR: A = A ^ *(*Z)
      case 0x50: // XRR	Bitwise XOR: A = A ^ *(*addr) §
        {
          const { val } = this.modeFn(IZBTR[opcode - 0x4c]).read();
          const { a } = Alu.xor(BYTE, this.a.read(), val);
          this.a.write(a);
        }
        break;

      case 0x51: // XR.Z	Bitwise XOR: *Z = *Z ^ A
      case 0x52: // XR.B	Bitwise XOR: *addr = *addr ^ A
        {
          const { read, write } = this.modeFn(ZBTRVWQL[opcode - 0x51]);
          const { addr, val } = read();
          const { a, res } = Alu.xor(BYTE, this.a.read(), val);
          this.a.write(a);
          write(addr, res);
        }
        break;

      case 0x53: // FNE: Fast branch on non-zero:  PC = PC_MSB + imm8
        {
          const imm8 = this.readByteFromPC();
          if (!this.flags.z()) this.pc.write((this.pc.read() & 0xff00) + imm8); //0x22
        }
        break;
      case 0x54: // FEQ: Fast branch on zero: if (A == 0) PC = PC_MSB + imm8
        {
          const imm8 = this.readByteFromPC();
          if (this.flags.z()) this.pc.write((this.pc.read() & 0xff00) + imm8);
        }
        break;
      case 0x55: // FCC: Fast branch on carry clear: if (C == 0) PC = PC_MSB + imm8
        {
          const imm8 = this.readByteFromPC();
          if (!this.flags.c()) this.pc.write((this.pc.read() & 0xff00) + imm8);
        }
        break;
      case 0x56: // FCS: Fast branch on carry set
        {
          const imm8 = this.readByteFromPC();
          if (this.flags.c()) this.pc.write((this.pc.read() & 0xff00) + imm8);
        }
        break;
      case 0x57: // FPL: Fast branch on plus
        {
          const imm8 = this.readByteFromPC();
          if (!this.flags.n()) this.pc.write((this.pc.read() & 0xff00) + imm8);
        }
        break;
      case 0x58: // FMI:	Fast branch on minus
        {
          const imm8 = this.readByteFromPC();
          if (this.flags.n()) this.pc.write((this.pc.read() & 0xff00) + imm8);
        }
        break;
      case 0x59: {
        // FGT	Fast branch on greater
        const imm8 = this.readByteFromPC();
        if (this.flags.gt()) this.pc.write((this.pc.read() & 0xff00) + imm8);
        break;
      }
      case 0x5a: {
        // FLE	Fast branch on less or equal
        const imm8 = this.readByteFromPC();
        if (!this.flags.gt()) this.pc.write((this.pc.read() & 0xff00) + imm8);
        break;
      }
      case 0x5b: {
        // FPA	Fast jump to lsb addr
        const imm8 = this.readByteFromPC();
        this.pc.write((this.pc.read() & 0xff00) + imm8);
        break;
      }
      case 0x5c: {
        // BNE	Branch on non-zero
        const addr = this.readWordFromPC();
        if (!this.flags.z()) this.pc.write(addr);
        break;
      }
      case 0x5d: {
        // BEQ	Branch on zero
        const addr = this.readWordFromPC();
        if (this.flags.z()) this.pc.write(addr);
        break;
      }
      case 0x5e: {
        // BCC	Branch carry clear
        const addr = this.readWordFromPC();
        if (!this.flags.c()) this.pc.write(addr);
        break;
      }
      case 0x5f: {
        // BCS	Branch carry set
        const addr = this.readWordFromPC();
        if (this.flags.c()) this.pc.write(addr);
        break;
      }
      case 0x60: {
        // BPL	Branch plus
        const addr = this.readWordFromPC();
        if (!this.flags.n()) this.pc.write(addr);
        break;
      }
      case 0x61: {
        // BMI	Branch minus
        const addr = this.readWordFromPC();
        if (this.flags.n()) this.pc.write(addr);
        break;
      }
      case 0x62: {
        // BGT	Branch gt
        const addr = this.readWordFromPC();
        if (this.flags.gt()) this.pc.write(addr);
        break;
      }
      case 0x63: {
        // BLE	Branch <=
        const addr = this.readWordFromPC();
        if (!this.flags.gt()) this.pc.write(addr);
        break;
      }
      case 0x64: {
        // JPA: Jump to abs address: PC = addr
        this.pc.write(this.readWordFromPC());
        break;
      }
      case 0x65: {
        // JPR: Jump to rel address: PC = *addr
        this.pc.write(this.memory.readWord(this.readWordFromPC()));
        break;
      }
      case 0x66: {
        // JAR	Jump A-indexed to rel address: PC = *(addr + A)
        const addr = this.readWordFromPC();
        const pointer = addr + this.a.read();
        const lsb = pointer & 0xff;
        let flags = 0;
        if (lsb == 0) flags |= FLAG_Z;
        if (pointer > lsb) flags |= FLAG_C;
        if (lsb & 0x80) flags |= FLAG_N;
        this.flags.write(flags);
        this.pc.write(this.memory.readWord(pointer));
        // TODO test flags also LAB and LZB which calc flags from LZB
        break;
      }
      case 0x67: {
        // JPS: Jump to subroutine
        this.a.write(0);
        const ret = this.pc.read();
        const addr = this.readWordFromPC();
        const sp = this.memory.readWord(0xffff);
        this.memory.writeByte(0xff00 | sp, ret & 0xff); // push ret LSB to stack
        this.memory.writeByte(0xff00 | (sp - 1), ret >> 8); // push ret MSB to stack
        this.memory.writeByte(0xffff, (sp - 2) & 0xff);
        this.pc.write(addr);
        break;
      }
      case 0x68: {
        // JAS	Jump to subroutine conserving A §
        const ret = this.pc.read();
        const addr = this.readWordFromPC();
        const sp = this.memory.readWord(0xffff);
        this.memory.writeByte(0xff00 | sp, ret & 0xff); // push ret LSB to stack
        this.memory.writeByte(0xff00 | (sp - 1), ret >> 8); // push ret MSB to stack
        this.memory.writeByte(0xffff, (sp - 2) & 0xff);
        this.pc.write(addr);
        break;
      }
      case 0x69: {
        // RTS: Return from subroutine
        const sp = this.memory.readByte(0xffff);
        let pc = this.memory.readByte(0xff00 | (sp + 1)) << 8;
        pc |= this.memory.readByte(0xff00 | (sp + 2));
        pc += 2;
        this.pc.write(pc);
        this.memory.writeByte(0xffff, (sp + 2) & 0xff);
        break;
      }

      case 0x6a: {
        // PHS	Push A onto stack
        const sp = this.memory.readByte(0xffff);
        this.memory.writeByte(0xff00 | sp, this.a.read());
        this.memory.writeByte(0xffff, sp - 1);
        break;
      }
      case 0x6b: {
        // PLS	Pull A from stack
        const sp = this.memory.readByte(0xffff);
        this.a.write(this.memory.readByte(0xff00 | (sp + 1)));
        this.memory.writeByte(0xffff, sp + 1);
        break;
      }
      case 0x6c: {
        //LDS	Load from stack: A = *(0xff00 + SP + off)
        const sp = this.memory.readByte(0xffff);
        const offset = this.readByteFromPC();
        this.a.write(this.memory.readByte(0xff00 | (sp + offset)));
        break;
      }
      case 0x6d: {
        // STS	Store on stack: *(0xff00 + SP + off) = A
        const sp = this.memory.readByte(0xffff);
        const offset = this.readByteFromPC();
        this.memory.writeByte(0xff00 | (sp + offset), this.a.read());
        break;
      }
      case 0x6e: {
        // RDB: Read FLASH data from abs 3-byte address addr,bnk
        const addr = this.readWordFromPC();
        const bank = this.readByteFromPC();
        this.memory.bank.write(bank);
        const res = this.memory.readByte(addr);
        this.memory.bank.write(0xff);
        this.a.write(res);
        break;
      }
      case 0x6f: {
        // RDR: Read FLASH data from rel 3-byte address
        const reladdr = this.readWordFromPC();
        const addr = this.memory.readWord(reladdr);
        const bank = this.memory.readByte(reladdr + 2);
        this.memory.bank.write(bank);
        const res = this.memory.readByte(addr);
        this.memory.bank.write(0xff);
        this.a.write(res);
        break;
      }
      case 0x70: {
        // RAP	Read A-indexed FLASH data: A = *(pg<<8 + A)
        const pg = this.readByteFromPC();
        const bnk = this.readByteFromPC();
        this.memory.bank.write(bnk);
        this.a.write(this.memory.readByte((pg << 8) + this.a.read()));
        this.memory.bank.write(0xff);
        break;
      }
      case 0x71: {
        // RZP	Read Z-indexed FLASH data: A = *(pg<<8 + *Z)
        const z = this.readStarZ().val;
        const pg = this.readByteFromPC();
        const bnk = this.readByteFromPC();
        this.memory.bank.write(bnk);
        this.a.write(this.memory.readByte((pg << 8) + z));
        this.memory.bank.write(0xff);
        break;
      }
      case 0x72: {
        // WDB	Write FLASH data to abs 3-byte address §	addr,bnk
        const addr = this.readWordFromPC();
        const bank = this.readByteFromPC();
        this.memory.bank.write(bank);
        this.memory.writeByte(addr, this.a.read());
        this.memory.bank.write(0xff);
        break;
      }
      case 0x73: {
        // WDR	Write FLASH data to rel 3-byte address §addr
        const reladdr = this.readWordFromPC();
        const addr = this.memory.readWord(reladdr);
        const bank = this.memory.readByte(reladdr + 2);
        this.memory.bank.write(bank);
        this.memory.writeByte(addr, this.a.read());
        this.memory.bank.write(0xff);
        break;
      }

      case 0x74: // LDI: Load A immediate: A = imm
      case 0x75: //	LDZ	Load A from Z: A = *Z
      case 0x76: //	LDB	Load A from abs address: A = *addr
      case 0x77: //	LDT	Load A from rel address in zero page: A = *(*Z)
      case 0x78: //	LDR	Load A from relative address: A = *(*addr)
        {
          this.a.write(this.modeFn(IZBTR[opcode - 0x74]).read().val);
        }
        break;

      case 0x79: {
        // LAP: Load A A-indexed from page: A = *(pg<<8 + A)
        const pg = this.readByteFromPC();
        const addr = (pg << 8) + this.a.read();
        const value = this.memory.readByte(addr);
        this.a.write(value);
        break;
      }
      case 0x7a: {
        // LAB: Load A A-indexed from addr: A = *(addr + A)
        const baseaddr = this.readWordFromPC();
        const addr = baseaddr + this.a.read();
        this.flags.updateC(addr, true);
        this.flags.updateZN(addr);
        const value = this.memory.readByte(addr);
        this.a.write(value);
        break;
      }
      case 0x7b: {
        // LZP: Load A Z-indexed from page: A = *(pg<<8 + *Z)
        const zaddr = this.readByteFromPC();
        const zval = this.memory.readByte(zaddr);
        const pg = this.readByteFromPC();
        const addr = (pg << 8) + zval;
        const value = this.memory.readByte(addr);
        this.a.write(value);
        break;
      }
      case 0x7c: {
        // LZB: Load A Z-indexed from addr: A = *(addr + *Z)
        const zaddr = this.readByteFromPC();
        const zval = this.memory.readByte(zaddr);
        const baseaddr = this.readWordFromPC();
        const addr = baseaddr + zval;
        this.flags.updateC(addr, true);
        this.flags.updateZN(addr);
        const value = this.memory.readByte(addr);
        this.a.write(value);
        break;
      }

      case 0x7d: //	STZ	Store A to Z: *Z = A
      case 0x7e: //	STB	Store A to address: *addr = A
      case 0x7f: //	STT	Store A at rel address in zero page: *(*Z) = A
      case 0x80: //	STR	Store A at relative address: *(*addr) = A
        {
          const { read, write } = this.modeFn(ZBTRVWQL[opcode - 0x7d]);
          const { addr } = read();
          write(addr, this.a.read());
          // no a or flags
        }
        break;

      case 0x81: {
        // SZP	Store A Z-indexed to page: *(pg<<8 + *Z) = A
        // Z, pg
        const Z = this.readStarZ().val;
        const pg = this.readByteFromPC();
        const addr = (pg << 8) + Z;
        this.memory.writeByte(addr, this.a.read());
        break;
      }

      case 0x82: //	MIZ	Move imm byte to zero-page: *Z = imm
      case 0x83: //	MIB	Move imm byte to abs addr: *addr = imm
      case 0x84: //	MIT	Move imm byte to rel zero-page addr: *(*T) = imm
      case 0x85: //	MIR	Move imm byte to rel addr: *(*addr) = imm
        {
          const imm8 = this.readByteFromPC();
          const { addr } = this.modeFn(ZBTRVWQL[opcode - 0x82]).read();
          this.a.write(imm8);
          this.memory.writeByte(addr, imm8);
          // no flags
        }
        break;

      case 0x86: //	MIV	Move imm word to zero-page word: *V = imm
      case 0x87: //	MIW	Move imm word to abs addr: *addr = imm
        {
          const imm16 = this.readWordFromPC();
          const { addr } = this.modeFn(ZBTRVWQL[opcode - 0x86 + 4]).read();
          this.a.write(imm16 >> 8);
          this.memory.writeWord(addr, imm16);
        }
        break;

      case 0x88: {
        // MZZ	Move zero-page byte to zero-page byte: *Z2 = *Z1
        const z1addr = this.readByteFromPC();
        const z2addr = this.readByteFromPC();
        const z1val = this.memory.readByte(z1addr);
        this.a.write(z1val);
        // No flags to change for MIW
        this.memory.writeByte(z2addr, z1val);
        break;
      }
      case 0x89: {
        // MZB	Move zero-page byte to abs addr: *addr = *Z
        const zaddr = this.readByteFromPC();
        const addr = this.readWordFromPC();
        const zval = this.memory.readByte(zaddr);
        this.a.write(zval);
        this.memory.writeWord(addr, zval);
        break;
      }
      case 0x8a: {
        // MBZ	Move byte at abs addr to zero-page: *Z = *addr
        const addr = this.readWordFromPC();
        const zaddr = this.readByteFromPC();
        const byte = this.memory.readByte(addr);
        this.a.write(byte);
        this.memory.writeByte(zaddr, byte);
        break;
      }
      case 0x8b: {
        // MBB	Move byte from abs adr1 to abs adr2: *adr2 = *adr1
        const addr1 = this.readWordFromPC();
        const addr2 = this.readWordFromPC();
        const byte1 = this.memory.readByte(addr1);
        this.a.write(byte1);
        this.memory.writeByte(addr2, byte1);
        break;
      }
      case 0x8c: {
        // MVV	Move zero-page word to zero-page word: *V2 = *V1
        const v1 = this.readByteFromPC();
        const v2 = this.readByteFromPC();
        const v1val = this.memory.readWord(v1);
        this.a.write(v1val >> 8);
        this.memory.writeWord(v2, v1val);
        break;
      }
      case 0x8d: {
        // MWV	Move word at abs addr to fast word: *V = *addr
        const addr = this.readWordFromPC();
        const zaddr = this.readByteFromPC();
        const word = this.memory.readWord(addr);
        this.a.write(word >> 8);
        this.memory.writeWord(zaddr, word);
        break;
      }
      case 0x8e: {
        // CLZ	Clear Z: *Z = 0x00
        const zaddr = this.readByteFromPC();
        this.memory.writeByte(zaddr, 0);
        break;
      }
      case 0x8f: {
        // CLB	Clear byte at addr: *addr = 0x00
        const addr = this.readWordFromPC();
        this.memory.writeByte(addr, 0);
        break;
      }
      case 0x90: {
        // CLV	Clear fast word: *V = 0x0000
        const zaddr = this.readByteFromPC();
        this.memory.writeWord(zaddr, 0);
        break;
      }
      case 0x91: {
        // CLW	Clear word at addr: *addr = 0x0000
        const addr = this.readWordFromPC();
        this.memory.writeWord(addr, 0);
        this.a.write(0);
        break;
      }
      case 0x92: {
        // CLQ	Clear zero-page long: *Q = 0x00000000
        const zaddr = this.readByteFromPC();
        this.memory.writeLong(zaddr, 0);
        break;
      }
      case 0x93: {
        // CLL: Clear long: *addr = 0x00000000
        const addr = this.readWordFromPC();
        this.a.write(0);
        this.memory.writeLong(addr, 0);
        break;
      }
      case 0x94: {
        // INC Increment A: A = A + 1
        const { a, flags } = Alu.inc(BYTE, this.a.read());
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0x95: // INZ zero-page byte: *Z = *Z + 1
      case 0x96: // INB byte at abs addr: *addr = *addr + 1
      case 0x97: // INV zero-page word: *V = *V + 0x0001
      case 0x98: // INW word at abs addr: *addr = *addr + 0x0001
      case 0x99: // INQ zero-page long: *Q = *Q + 0x00000001
      case 0x9a: // INL long: *addr = *addr + 0x00000001
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x95]);
          const { addr, val } = read();
          const { a, res, flags } = Alu.inc(size, val);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0x9b: {
        // DEC: Decrement A: A = A - 1
        const { a, flags } = Alu.dec(BYTE, this.a.read());
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0x9c: // DEZ	Decrement *Z = *Z - 1
      case 0x9d: // DEB	Decrement byte: *addr = *addr - 1
      case 0x9e: // DEV	Decrement zero-page word: *V = *V - 0x0001
      case 0x9f: // DEW	Decrement word at abs addr: *addr = *addr - 0x0001
      case 0xa0: // DEQ	Decrement zero-page long: *Q = *Q - 0x00000001
      case 0xa1: // DEL	Decrement long: *addr = *addr - 0x00000001
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0x9c]);
          const { addr, val } = read();
          const { a, res, flags } = Alu.dec(size, val);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0xa2: // ADI: Add immediate to A: A = A + imm
        {
          const val = this.readImm8().val;
          const { a, flags } = Alu.add(BYTE, this.a.read(), val);
          this.a.write(a);
          this.flags.write(flags);
        }
        break;

      case 0xa3: // ADZ	Add zero-page byte to A: A = A + *Z
      case 0xa4: // ADB	Add byte at addr to A: A = A + *addr
      case 0xa5: // ADT	Add byte at rel zero-page addr to A: A = A + *(*Z)
      case 0xa6: // ADR	Add byte at rel addr to A: A = A + *(*addr)
        {
          const { read, size } = this.modeFn(ZBTRVWQL[opcode - 0xa3]);
          const { val } = read();
          const { a, flags } = Alu.add(size, this.a.read(), val);
          this.a.write(a);
          this.flags.write(flags);
        }
        break;

      case 0xa7: // AD.Z	Add A to zero-page byte: *Z = *Z + A
      case 0xa8: // AD.B	Add A to byte at abs addr: *addr = *addr + A
      case 0xa9: // AD.T	Add A to rel zero-page address: *(*Z) = *(*Z) + A
      case 0xaa: // AD.R	Add A to rel address: *(*addr) = *(*addr) + A
        {
          const { read, write, size } = this.modeFn(ZBTRVWQL[opcode - 0xa7]);
          const { val, addr } = read();
          const { a, res, flags } = Alu.add(size, val, this.a.read());
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0xab: // ADV	Add A to zero-page word: *V = *V + A
      case 0xac: // ADW	Add A to word at abs addr: *addr = *addr + A
      case 0xad: // ADQ	Add A to zero-page long: *Q = *Q + A
      case 0xae: // ADL	Add A to long: *addr = *addr + A
        {
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xab + 2]);
          const { val, addr } = read();
          const { a, res, flags } = Alu.add(size, val, this.a.read());
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0xaf: // AIZ	Add immediate to zero-page byte: *Z = *Z + imm
      case 0xb0: // AIB	Add imm to byte at abs addr: *addr = *addr + imm
      case 0xb1: // AIT	Add imm to byte at rel Z addr: *(*Z) = *(*Z) + imm
      case 0xb2: // AIR	Add imm to byte at rel addr: *(*adr) = *(*adr) + imm
      case 0xb3: // AIV	Add immediate byte to zero-page word: *V = *V + imm
      case 0xb4: // AIW	Add imm byte to abs word: *addr = *addr + imm
      case 0xb5: // AIQ	Add immediate byte to zero-page long: *Q = *Q + imm
      case 0xb6: // AIL	Add immediate byte to long: *L = *L + imm
        {
          const imm = this.readImm8().val;
          const { read, write, size } = this.modeFn(ZBTRVWQL[opcode - 0xaf]);
          const { val, addr } = read();
          const { a, res, flags } = Alu.add(size, val, imm);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0xb7: // AZZ	Add zero-page byte to zero-page byte: *Z2 = *Z2 + *Z1
      case 0xb8: // AZB	Add zero-page to byte at abs addr: *addr = *addr + *Z
      case 0xb9: // AZV	Add zero-page byte to zero-page word: *V = *V + *Z
      case 0xba: // AZW	Add zero-page byte to word at addr: *addr = *addr + *Z
      case 0xbb: // AZQ	Add zero-page byte to zero-page long: *Q = *Q + *Z
      case 0xbc: // AZL	Add zero-page byte to long: *L = *L + *Z
        {
          const { val: zybte } = this.readStarZ();
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xb7]);
          const { val, addr } = read();
          const { a, res, flags } = Alu.add(size, val, zybte);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0xbd: // ABZ abs byte to zero-page byte: *Z = *Z + *addr
      case 0xbe: // ABB abs byte to byte: *adr2 = *adr2 + *adr1
      case 0xbf: // ABV abs byte to zero-page word: *V = *V + *addr
      case 0xc0: // ABW byte at ad1 to word at ad2: *ad2 = *ad2 + *ad1
      case 0xc1: // ABQ abs byte to zero-page long: *Q = *Q + *addr
        {
          const { val: addrval } = this.readStarB();
          const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xbd]);
          const { val, addr } = read();
          const { a, res, flags } = Alu.add(size, val, addrval);
          this.a.write(a);
          this.flags.write(flags);
          write(addr, res);
        }
        break;

      case 0xc2: {
        // AVV	Add zero-page word to zero-page word: *V2 = *V2 + *V1	// V1,V2
        const { val: v1val } = this.readStarV();
        const { addr: v2addr, val: v2val } = this.readStarV();
        const { a, res, flags } = Alu.add(Alu.WORD, v2val, v1val);
        this.a.write(a);
        this.flags.write(flags);
        this.memory.writeWord(v2addr, res);
        break;
      }

      case 0xc3: {
        // SUI: Sub immediate from A: A = A - imm
        const val = this.readImm8().val;
        const { a, flags } = Alu.sub(BYTE, this.a.read(), val);
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0xc4:
      case 0xc5:
      case 0xc6:
      case 0xc7: {
        // 0xc4	SUZ	Sub zero-page byte from A: A = A - *Z
        // 0xc5	SUB	Sub byte at addr from A: A = A - *addr
        // 0xc6	SUT	Sub byte at rel zero-page addr from A: A = A - *(*Z)
        // 0xc7	SUR	Sub byte at rel addr from A: A = A - *(*addr)
        const { read, size } = this.modeFn(ZBTRVWQL[opcode - 0xc4]);
        const { val } = read();
        const { a, flags } = Alu.sub(size, this.a.read(), val);
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0xc8:
      case 0xc9:
      case 0xca:
      case 0xcb: {
        // 0xc8	SU.Z	Sub A from zero-page byte: *Z = *Z - A
        // 0xc9	SU.B	Sub A from byte at abs addr: *addr = *addr - A
        // 0xca	SU.T	Sub A from rel zero-page address: *(*Z) = *(*Z) - A
        // 0xcb	SU.R	Sub A from byte at rel addr: *(*addr) = *(*addr) - A
        const { read, write, size } = this.modeFn(ZBTRVWQL[opcode - 0xc8]);
        const { val, addr } = read();
        const { a, res, flags } = Alu.sub(size, val, this.a.read());
        this.a.write(a);
        this.flags.write(flags);
        write(addr, res);
        break;
      }

      case 0xcc:
      case 0xcd:
      case 0xce:
      case 0xcf: {
        // 0xcc	SUV	Sub A from zero-page word: *v = *V - A
        // 0xcd	SUW	Sub A from word at abs addr: *addr = *addr - A
        // 0xce	SUQ	Sub A from zero-page long: *Q = *Q - A
        // 0xcf	SUL	Sub A from long: *addr = *addr - A
        const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xcc + 2]);
        const { val, addr } = read();
        const { a, res, flags } = Alu.sub(size, val, this.a.read());
        this.a.write(a);
        this.flags.write(flags);
        write(addr, res);
        break;
      }

      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3:
      case 0xd4:
      case 0xd5:
      case 0xd6:
      case 0xd7: {
        // 0xd0	SIZ	Sub immediate from zero-page byte: *Z = *Z - imm
        // 0xd1	SIB	Sub imm from byte: *addr = *addr - imm
        // 0xd2	SIT	Sub imm from byte at rel Z addr: *(*Z) = *(*Z) + imm
        // 0xd3	SIR	Sub imm from byte at rel addr: *(*ad) = *(*ad) + imm
        // 0xd4	SIV	Sub imm byte from zero-page word: *V = *V - imm
        // 0xd5	SIW	Sub imm byte from abs word: *addr = *addr - imm
        // 0xd6	SIQ	Sub imm byte from zero-page long Z: *Z = *Z - imm
        // 0xd7	SIL	Sub imm byte from long at abs address: *L = *L - imm
        const imm = this.readImm8().val;
        const { read, write, size } = this.modeFn(ZBTRVWQL[opcode - 0xd0]);
        const { val, addr } = read();
        const { a, res, flags } = Alu.sub(size, val, imm);
        this.a.write(a);
        this.flags.write(flags);
        write(addr, res);
        break;
      }

      case 0xd8:
      case 0xd9:
      case 0xda:
      case 0xdb:
      case 0xdc:
      case 0xdd: {
        // 0xd8	SZZ	Sub zero-page byte from Z byte: *Z2 = *Z2 - *Z1
        // 0xd9	SZB	Sub zero-page byte from abs byte: *addr = *addr - *Z
        // 0xda	SZV	Sub zero-page byte from zero-page word: *V = *V - *Z
        // 0xdb	SZW	Sub zero-page byte from abs word: *addr = *addr - *Z
        // 0xdc	SZQ	Sub zero-page byte from zero-page long: *Q = *Q - *Z
        // 0xdd	SZL	Sub zero-page byte from long: *L = *L - *Z
        const { val: zybte } = this.readStarZ();
        const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xd8]);
        const { val, addr } = read();
        const { a, res, flags } = Alu.sub(size, val, zybte);
        this.a.write(a);
        this.flags.write(flags);
        write(addr, res);
        break;
      }

      case 0xde:
      case 0xdf:
      case 0xe0:
      case 0xe1:
      case 0xe2: {
        // 0xde	SBZ	Sub abs byte from zero-page byte: *Z = *Z - *addr
        // 0xdf	SBB	Sub abs byte from byte: *adr2 = *adr2 - *adr1
        // 0xe0	SBV	Sub abs byte from zero-page word: *V = *V - *addr
        // 0xe1	SBW	Sub abs byte from word at adr2: *adr2 = *adr2 - *adr1
        // 0xe2	SBQ	Sub abs byte from zero-page long: *Q = *Q - *addr
        const { val: addrval } = this.readStarB();
        const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xde]);
        const { val, addr } = read();
        const { a, res, flags } = Alu.sub(size, val, addrval);
        this.a.write(a);
        this.flags.write(flags);
        write(addr, res);
        break;
      }

      case 0xe3: {
        // 0xe3	SVV	Sub zero-page word from word: *V2 = *V2 - *V1
        const { val: v1val } = this.readStarV();
        const { addr: v2addr, val: v2val } = this.readStarV();
        const { a, res, flags } = Alu.sub(Alu.WORD, v2val, v1val);
        this.a.write(a);
        this.flags.write(flags);
        this.memory.writeWord(v2addr, res);
        break;
      }

      case 0xe4:
      case 0xe5:
      case 0xe6:
      case 0xe7:
      case 0xe8: {
        // CPI: Compare immediate value to A: eval A - imm
        // CPZ: Compare zero-page byte to A: eval A - *Z
        // CPB: Compare byte at addr to A: eval A - *addr
        // CPT: Compare byte at rel Z to A: eval A - *(*Z)
        // CPR: Compare rel byte to A: eval A - *(*addr)
        const { read, size } = this.modeFn(IZBTR[opcode - 0xe4]);
        const { flags } = Alu.sub(size, this.a.read(), read().val);
        this.flags.write(flags);
        break;
      }

      case 0xe9:
      case 0xea:
      case 0xeb:
      case 0xec: {
        // CIZ	Compare imm to zero-page byte: A = *Z - imm
        // CIB  Compare imm to byte at abs addr: A = *addr - imm
        // CIT	Compare imm to byte at rel Z: A = *(*Z) - imm
        // CIR	Compare imm to byte at rel addr: A = *(*addr) - imm
        const immediate = this.readByteFromPC();
        const { val } = this.modeFn(ZBTRVWQL[opcode - 0xe9]).read();
        const res = val - immediate;
        this.a.write(res);
        this.flags.update(res, false);
        break;
      }

      case 0xed:
      case 0xee: {
        // 0xed CZZ	Compare zero-page byte to byte: A = *Z2 - *Z1
        // 0xee CZB	Compare zero-page byte to byte: A = *addr - *Z\
        const { val: zybte } = this.readStarZ();
        const { val } = this.modeFn(ZBTRVWQL[opcode - 0xed]).read();
        const { a, flags } = Alu.sub(BYTE, val, zybte);
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0xef:
      case 0xf0: {
        // CBZ	Compare abs byte to zero-page byte: A = *addr - *Z
        // CBB	Compare abs byte to byte: A = *adr2 - *adr1
        const absbyte = this.readStarB().val;
        const { val } = this.modeFn(ZBVWQL[opcode - 0xef]).read();
        const { a, flags } = Alu.sub(BYTE, absbyte, val);
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0xf1:
      case 0xf2:
      case 0xf3: {
        // ACI	Add immediate value to A with C: A = A + imm + C
        // ACZ	Add zero-page byte with C to A: A = A + *Z + C
        // ACB	Add byte at addr with C to A: A = A + *addr + C
        const { val } = this.modeFn(IZBTR[opcode - 0xf1]).read();
        const { a, flags } = Alu.add(BYTE, this.a.read(), val, this.flags.c());
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0xf4:
      case 0xf5:
      case 0xf6:
      case 0xf7: {
        // 0xf4	AC.Z	Add A with C to zero-page byte: *Z = *Z + A + C
        // 0xf5	AC.B	Add A with C to byte at addr: *addr = *addr + A + C
        // 0xf6	ACV	Add A with C to zero-page word
        // 0xf7	ACW	Add A with C to word at ads addr: *adr = *adr + A + C
        const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xf4]);
        const { addr, val } = read();
        const { a, res, flags } = Alu.add(size, val, this.a.read(), this.flags.c());
        this.a.write(a);
        this.flags.write(flags);
        write(addr, res);
        break;
      }

      case 0xf8:
      case 0xf9:
      case 0xfa: {
        // 0xf8	SCI	Sub imm value from A with C: A = A - imm - 1 + C
        // 0xf9	SCZ	Sub zero-page byte with C from A: A = A - *Z - 1 + C
        // 0xfa	SCB	Sub byte at addr from A with C: A = A - *addr - 1 + C
        const { val } = this.modeFn(IZBTR[opcode - 0xf8]).read();
        const { a, flags } = Alu.sub(BYTE, this.a.read(), val, this.flags.c());
        this.a.write(a);
        this.flags.write(flags);
        break;
      }

      case 0xfb:
      case 0xfc:
      case 0xfd:
      case 0xfe: {
        // 0xfb	SC.Z	Sub A with C from zero-page byte: *Z = *Z - A - 1 + C
        // 0xfc	SC.B	Sub A with C from byte: *addr = *addr - A - 1 + C
        // 0xfd	SCV	Sub A with C from zero-page word
        // 0xfe	SCW	Sub A with C from word at abs addr
        const { read, write, size } = this.modeFn(ZBVWQL[opcode - 0xfb]);
        const { addr, val } = read();
        const { a, res, flags } = Alu.sub(size, val, this.a.read(), this.flags.c());
        this.a.write(a);
        this.flags.write(flags);
        write(addr, res);
        break;
      }

      case 0xff: {
        this.memory.bank.write(0xff); // flash off
        break;
      }
      default:
        throw Error("Unknown opcode: " + opcode.toString(16));
    }
    const cycles = instructionInfo[opcode].cycles;
    this.totalClocks = (this.totalClocks + cycles) & 0xffffffff;
    this.uart.waited(cycles);
    this.ps2.waited(cycles);
    return cycles;
  }

  traceStep() {
    this.step();
    return this.getEmulationState();
  }

  traceSteps(breakpoint: string) {
    const breakpc = breakpoint.startsWith("0x") ? parseInt(breakpoint, 16) : labelToAddress[breakpoint];
    if (!breakpc) return this.getEmulationState();
    console.log("tracing steps to breakpoint ", breakpc);
    let steps = 0;
    while (this.pc.read() != breakpc && steps < 50000) {
      this.step();
      steps++;
    }

    console.log(`Ran ${steps} steps`);
    return this.getEmulationState();
  }

  traceOver() {
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
    return this.getEmulationState();
  }

  frame(deltaTime: number) {
    let haveClocks = deltaTime / 8000000; // 8MHz clock
    while (haveClocks > 0) {
      haveClocks -= this.step();
    }
    return this.memory.getVRAMImage();
  }
}

export const cpu = new CPU();
