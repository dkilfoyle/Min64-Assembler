import { Memory, STACK_PAGE, SP_ADDRESS } from "./memory";
import { IoDevices } from "./io";
import { disassembleOne } from "./disassembler";

/** A read/write accessor for an addressed byte location (register-less "operand target"). */
interface ByteTarget {
  get(): number;
  set(v: number): void;
}
interface WordTarget {
  get16(): number;
  set16(v: number): void;
}
interface LongTarget {
  get32(): number;
  set32(v: number): void;
}

interface AddResult {
  result: number;
  carry: boolean;
}

/**
 * Instruction-level CPU core for the Minimal 64x4, Revision 1.4 "Redux".
 *
 * This models the programmer-visible effects of every instruction (registers, memory,
 * flags, PC, stack, I/O, FLASH banking) as specified in the reference manual and the
 * "Minimal 64x4 Redux Instruction Set" table, but does *not* model microcode timing,
 * individual control signals, or bus contention - see the manual's "CPU Architecture"
 * section for that level of detail.
 *
 * A number of instructions have a documented side effect where the accumulator (A) ends
 * up holding an intermediate value from the ALU pipeline even though the "logical"
 * operation writes its result to memory (e.g. `AD.Z: *Z = *Z + A` also leaves `A` holding
 * that same result). This is preserved exactly per-opcode below, matching the instruction
 * table's "Change in A" column, because real MinOS code occasionally relies on it.
 */
export class CPU {
  a = 0; // accumulator (8-bit)
  pc = 0; // program counter (16-bit)
  n = false; // negative flag
  c = false; // carry flag
  z = false; // zero flag
  halted = false; // true while WIN is blocking on empty input registers
  cyclesExecuted = 0; // running total of nominal cycle counts (approximate, not cycle-exact)
  readonly mem: Memory;
  readonly io: IoDevices;
  level = 0;

  constructor(mem: Memory, io: IoDevices) {
    this.mem = mem;
    this.io = io;
  }

  reset() {
    this.a = 0;
    this.pc = 0x0000;
    this.n = this.c = this.z = false;
    this.halted = false;
    this.cyclesExecuted = 0;
    this.level = 0;
  }

  // ---------------------------------------------------------------------------------
  // Fetch helpers
  // ---------------------------------------------------------------------------------

  private fetch8(): number {
    const v = this.mem.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  private fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  /** Fetch a byte and interpret it as a signed offset (-128..127), used by LDS/SDS. */
  private fetchSigned8(): number {
    const v = this.fetch8();
    return v >= 0x80 ? v - 0x100 : v;
  }

  // ---------------------------------------------------------------------------------
  // Addressing-mode target constructors. Each of these consumes the operand byte(s) it
  // needs from the instruction stream (via fetch8/fetch16) and returns an accessor for
  // the addressed storage location. Calling them in the order the instruction lists its
  // operands preserves the correct little-endian on-the-wire encoding.
  // ---------------------------------------------------------------------------------

  /** 'Z': direct zero-page byte, operand = 1-byte ZP address. */
  private zpTarget(): ByteTarget {
    const zp = this.fetch8();
    return { get: () => this.mem.read(zp), set: (v) => this.mem.write(zp, v & 0xff) };
  }
  /** 'V': direct zero-page word, operand = 1-byte ZP address. */
  private zpWordTarget(): WordTarget {
    const zp = this.fetch8();
    return { get16: () => this.mem.read16(zp), set16: (v) => this.mem.write16(zp, v & 0xffff) };
  }
  /** 'Q': direct zero-page long (4 bytes), operand = 1-byte ZP address. */
  private zpLongTarget(): LongTarget {
    const zp = this.fetch8();
    return { get32: () => this.mem.read32(zp), set32: (v) => this.mem.write32(zp, v >>> 0) };
  }
  /** 'B'/'addr': direct absolute byte, operand = 2-byte address. */
  private absTarget(): ByteTarget {
    const addr = this.fetch16();
    return { get: () => this.mem.read(addr), set: (v) => this.mem.write(addr, v & 0xff) };
  }
  /** 'W': direct absolute word, operand = 2-byte address. */
  private absWordTarget(): WordTarget {
    const addr = this.fetch16();
    return { get16: () => this.mem.read16(addr), set16: (v) => this.mem.write16(addr, v & 0xffff) };
  }
  /** 'L': direct absolute long, operand = 2-byte address. */
  private absLongTarget(): LongTarget {
    const addr = this.fetch16();
    return { get32: () => this.mem.read32(addr), set32: (v) => this.mem.write32(addr, v >>> 0) };
  }
  /** 'T': relative (pointer) byte via a 2-byte pointer stored at a ZP address: **Z. */
  private zpIndirectTarget(): ByteTarget {
    const zp = this.fetch8();
    const ptr = this.mem.read16(zp);
    return { get: () => this.mem.read(ptr), set: (v) => this.mem.write(ptr, v & 0xff) };
  }
  /** 'R': relative (pointer) byte via a 2-byte pointer stored at an absolute address: **addr. */
  private absIndirectTarget(): ByteTarget {
    const addr = this.fetch16();
    const ptr = this.mem.read16(addr);
    return { get: () => this.mem.read(ptr), set: (v) => this.mem.write(ptr, v & 0xff) };
  }

  // ---------------------------------------------------------------------------------
  // ALU helpers. All arithmetic on this CPU is implemented via a single adder: A - B is
  // computed as A + ~B + 1 (see manual, "Arithmetic and Logic Unit"). `carryIn` therefore
  // takes the place of "EC": 0 for plain add, 1 for plain subtract (no borrow-in), or the
  // current C flag for the add/sub-with-carry family.
  // ---------------------------------------------------------------------------------

  private add8(a: number, b: number, carryIn: number): AddResult {
    const sum = (a & 0xff) + (b & 0xff) + carryIn;
    return { result: sum & 0xff, carry: sum > 0xff };
  }
  private sub8(a: number, b: number, carryIn: number): AddResult {
    return this.add8(a, ~b & 0xff, carryIn);
  }
  private add16(a: number, b: number, carryIn: number): AddResult {
    const sum = (a & 0xffff) + (b & 0xffff) + carryIn;
    return { result: sum & 0xffff, carry: sum > 0xffff };
  }
  private sub16(a: number, b: number, carryIn: number): AddResult {
    return this.add16(a, ~b & 0xffff, carryIn);
  }
  private add32(a: number, b: number): number {
    return ((a >>> 0) + (b >>> 0)) >>> 0;
  }
  private sub32(a: number, b: number): number {
    return ((a >>> 0) - (b >>> 0)) >>> 0;
  }

  /** Sets N/Z/C from a full 8-bit byte result (the 'R' flag code). */
  private setFlagsByte(result: number, carry: boolean): void {
    this.n = (result & 0x80) !== 0;
    this.z = result === 0;
    this.c = carry;
  }
  /** Sets N/Z from the MSB byte of a 16-bit result, C from the real carry-out (the 'M' code). */
  private setFlagsWordMsb(result16: number, carry: boolean): void {
    const hi = (result16 >> 8) & 0xff;
    this.n = (hi & 0x80) !== 0;
    this.z = hi === 0;
    this.c = carry;
  }

  private setFlagsWord16(result16: number, carry: boolean): void {
    this.n = (result16 & 0x8000) !== 0;
    this.z = (result16 & 0xffff) === 0;
    this.c = carry;
  }

  // ---------------------------------------------------------------------------------
  // Stack helpers. Stack page is fixed at 0xff00-0xffff; SP (at 0xffff) grows downward.
  // ---------------------------------------------------------------------------------

  private getSp(): number {
    return this.mem.read(SP_ADDRESS);
  }
  private setSp(v: number): void {
    this.mem.write(SP_ADDRESS, v & 0xff);
  }
  private push8(v: number): void {
    const sp = this.getSp();
    this.mem.write(STACK_PAGE + sp, v & 0xff);
    this.setSp((sp - 1) & 0xff);
  }
  private pop8(): number {
    const sp = (this.getSp() + 1) & 0xff;
    this.setSp(sp);
    return this.mem.read(STACK_PAGE + sp);
  }

  // ---------------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------------

  /** Executes exactly one instruction (or, if WIN is blocking, checks/waits once). */
  step(): number {
    const opcode = this.fetch8();
    // if (this.pc > 0xf05a && this.pc < 0xf135)
    //   console.log(`${this.pc.toString(16).padStart(4, "0")}: ${disassembleOne(this.mem, this.pc - 1).text}`);
    return this.execute(opcode);
  }

  // eslint-disable-next-line complexity
  private execute(op: number): number {
    switch (op) {
      // ============================================================ 0x00-0x04: control/IO
      case 0x00: // NOP
        break;
      case 0x01: // OUT: UART = A. Flags are unconditionally forced by hardware.
        this.io.writeUart(this.a);
        this.n = true;
        this.c = false;
        this.z = false;
        break;
      case 0x02: // INT: A = UART (cleared to 0xff on read)
        this.a = this.io.readUart();
        break;
      case 0x03: // INK: A = PS/2 (cleared to 0xff on read)
        this.a = this.io.readKeyboard();
        break;
      case 0x04: // WIN: halt until UART or PS/2 has data
        if (this.io.shouldWaitForInput()) {
          this.pc = (this.pc - 1) & 0xffff; // re-execute WIN next step
          this.halted = true;
        } else {
          this.halted = false;
        }
        break;

      // ============================================================ 0x05-0x14: LL/RL shifts
      case 0x05: // LL0: no-op shift (0 steps)
        break;
      case 0x06:
      case 0x07:
      case 0x08:
      case 0x09:
      case 0x0a:
      case 0x0b:
      case 0x0c: {
        // LL1..LL7: logical left shift A by (op-0x05) steps
        const steps = op - 0x05;
        this.a = this.shiftLeftLogical(this.a, steps);
        break;
      }
      case 0x0d: // RL0: no-op rotate
        break;
      case 0x0e:
      case 0x0f:
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14: {
        // RL1..RL7: rotate A left through carry by (op-0x0d) steps
        const steps = op - 0x0d;
        this.a = this.rotateLeftThroughCarry(this.a, steps);
        break;
      }

      // ============================================================ 0x15-0x1d: RR1, LR0-LR7
      case 0x15: // RR1: rotate A right through carry, 1 step
        this.a = this.rotateRightThroughCarry(this.a, 1);
        break;
      case 0x16: // LR0: no-op shift
        break;
      case 0x17:
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1b:
      case 0x1c:
      case 0x1d: {
        // LR1..LR7: logical right shift A by (op-0x16) steps
        const steps = op - 0x16;
        this.a = this.shiftRightLogical(this.a, steps);
        break;
      }

      // ============================================================ 0x1e-0x2d: memory shift/rotate
      case 0x1e: {
        // LLZ: *Z <<= 1 (logical)
        const t = this.zpTarget();
        const r = this.shiftLeftLogicalFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }
      case 0x1f: {
        // LLB: *addr <<= 1 (logical)
        const t = this.absTarget();
        const r = this.shiftLeftLogicalFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }
      case 0x20: {
        // LLV: *V <<= 1 (word, logical)
        const t = this.zpWordTarget();
        const r = this.shiftLeftWord(t.get16());
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      }
      case 0x21: {
        // LLW: *addr <<= 1 (word, logical)
        const t = this.absWordTarget();
        const r = this.shiftLeftWord(t.get16());
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      }
      case 0x22: {
        // LLQ: *Q <<= 1 (long, logical)
        const t = this.zpLongTarget();
        const { result, topByte } = this.shiftLeftLong(t.get32());
        t.set32(result);
        this.a = topByte;
        this.setFlagsByte(topByte, ((result >>> 31) & 1) !== 0 /*unused*/);
        // Carry for long shift = bit shifted out of bit31 (captured before shifting)
        break;
      }
      case 0x23: {
        // LLL: *addr <<= 1 (long, logical)
        const t = this.absLongTarget();
        const { result, topByte, carry } = this.shiftLeftLong(t.get32());
        t.set32(result);
        this.a = topByte;
        this.setFlagsByte(topByte, carry);
        break;
      }
      case 0x24: {
        // LRZ: *Z >>= 1 (logical)
        const t = this.zpTarget();
        const r = this.shiftRightLogicalFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }
      case 0x25: {
        // LRB: *addr >>= 1 (logical)
        const t = this.absTarget();
        const r = this.shiftRightLogicalFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }
      case 0x26: {
        // RLZ: *Z rotate left through carry, 1 step
        const t = this.zpTarget();
        const r = this.rotateLeftFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }
      case 0x27: {
        // RLB: *addr rotate left through carry, 1 step
        const t = this.absTarget();
        const r = this.rotateLeftFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }
      case 0x28: {
        // RLV: *V rotate left through carry (word)
        const t = this.zpWordTarget();
        const r = this.rotateLeftWord(t.get16());
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      }
      case 0x29: {
        // RLW: *addr rotate left through carry (word)
        const t = this.absWordTarget();
        const r = this.rotateLeftWord(t.get16());
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      }
      case 0x2a: {
        // RLQ: *Q rotate left through carry (long)
        const t = this.zpLongTarget();
        const r = this.rotateLeftLong(t.get32());
        t.set32(r.result);
        this.a = r.topByte;
        this.setFlagsByte(r.topByte, r.carry);
        break;
      }
      case 0x2b: {
        // RLL: *addr rotate left through carry (long)
        const t = this.absLongTarget();
        const r = this.rotateLeftLong(t.get32());
        t.set32(r.result);
        this.a = r.topByte;
        this.setFlagsByte(r.topByte, r.carry);
        break;
      }
      case 0x2c: {
        // RRZ: *Z rotate right through carry, 1 step
        const t = this.zpTarget();
        const r = this.rotateRightFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }
      case 0x2d: {
        // RRB: *addr rotate right through carry, 1 step
        const t = this.absTarget();
        const r = this.rotateRightFlagged(t.get());
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      }

      // ============================================================ 0x2e-0x39: NOT / NEG
      case 0x2e: // NOT: A = ~A (flags unaffected)
        this.a = ~this.a & 0xff;
        break;
      case 0x2f: {
        // NOZ: *Z = ~*Z (flags unaffected, A := result)
        const t = this.zpTarget();
        const r = ~t.get() & 0xff;
        t.set(r);
        this.a = r;
        break;
      }
      case 0x30: {
        // NOB: *addr = ~*addr
        const t = this.absTarget();
        const r = ~t.get() & 0xff;
        t.set(r);
        this.a = r;
        break;
      }
      case 0x31: {
        // NOV: *V = ~(*V) (word, A := MSB)
        const t = this.zpWordTarget();
        const r = ~t.get16() & 0xffff;
        t.set16(r);
        this.a = (r >> 8) & 0xff;
        break;
      }
      case 0x32: {
        // NOW: *addr = ~(*addr) (word)
        const t = this.absWordTarget();
        const r = ~t.get16() & 0xffff;
        t.set16(r);
        this.a = (r >> 8) & 0xff;
        break;
      }
      case 0x33: {
        // NOQ: *Q = ~(*Q) (long, A := top byte)
        const t = this.zpLongTarget();
        const r = ~t.get32() >>> 0;
        t.set32(r);
        this.a = (r >>> 24) & 0xff;
        break;
      }
      case 0x34: {
        // NEG: A = -A ; C set only if result==0
        const r = (0x100 - this.a) & 0xff;
        this.a = r;
        this.setFlagsByte(r, r === 0);
        break;
      }
      case 0x35: {
        // NEZ: *Z = -*Z
        const t = this.zpTarget();
        const r = (0x100 - t.get()) & 0xff;
        t.set(r);
        this.a = r;
        this.setFlagsByte(r, r === 0);
        break;
      }
      case 0x36: {
        // NEB: *addr = -*addr
        const t = this.absTarget();
        const r = (0x100 - t.get()) & 0xff;
        t.set(r);
        this.a = r;
        this.setFlagsByte(r, r === 0);
        break;
      }
      case 0x37: {
        // NEV: *V = -*V (word); C = 1 only if word == 0
        const t = this.zpWordTarget();
        const r = (0x10000 - t.get16()) & 0xffff;
        t.set16(r);
        this.a = (r >> 8) & 0xff;
        this.setFlagsWordMsb(r, r === 0);
        break;
      }
      case 0x38: {
        // NEW: *addr = -*addr (word)
        const t = this.absWordTarget();
        const r = (0x10000 - t.get16()) & 0xffff;
        t.set16(r);
        this.a = (r >> 8) & 0xff;
        this.setFlagsWordMsb(r, r === 0);
        break;
      }
      case 0x39: {
        // NEQ: *Q = -*Q (long); C = 1 only if long == 0
        const t = this.zpLongTarget();
        const r = (0x100000000 - t.get32()) >>> 0;
        t.set32(r);
        this.a = (r >>> 24) & 0xff;
        this.n = (this.a & 0x80) !== 0;
        this.z = this.a === 0;
        this.c = r === 0;
        break;
      }

      // ============================================================ 0x3a-0x54: AND/OR/XOR (flags untouched)
      case 0x3a:
        this.a = this.a & this.fetch8();
        break; // ANI
      case 0x3b:
        this.a = this.a & this.zpTarget().get();
        break; // ANZ
      case 0x3c:
        this.a = this.a & this.absTarget().get();
        break; // ANB
      case 0x3d:
        this.a = this.a & this.zpIndirectTarget().get();
        break; // ANT
      case 0x3e:
        this.a = this.a & this.absIndirectTarget().get();
        break; // ANR
      case 0x3f: {
        const t = this.zpTarget();
        const r = t.get() & this.a;
        t.set(r);
        this.a = r;
        break;
      } // AN.Z
      case 0x40: {
        const t = this.absTarget();
        const r = t.get() & this.a;
        t.set(r);
        this.a = r;
        break;
      } // AN.B
      case 0x41: {
        const t = this.zpIndirectTarget();
        const r = t.get() & this.a;
        t.set(r);
        this.a = r;
        break;
      } // AN.T
      case 0x42: {
        const t = this.absIndirectTarget();
        const r = t.get() & this.a;
        t.set(r);
        this.a = r;
        break;
      } // AN.R
      case 0x43:
        this.a = this.a | this.fetch8();
        break; // ORI
      case 0x44:
        this.a = this.a | this.zpTarget().get();
        break; // ORZ
      case 0x45:
        this.a = this.a | this.absTarget().get();
        break; // ORB
      case 0x46:
        this.a = this.a | this.zpIndirectTarget().get();
        break; // ORT
      case 0x47:
        this.a = this.a | this.absIndirectTarget().get();
        break; // ORR
      case 0x48: {
        const t = this.zpTarget();
        const r = t.get() | this.a;
        t.set(r);
        this.a = r;
        break;
      } // OR.Z
      case 0x49: {
        const t = this.absTarget();
        const r = t.get() | this.a;
        t.set(r);
        this.a = r;
        break;
      } // OR.B
      case 0x4a: {
        const t = this.zpIndirectTarget();
        const r = t.get() | this.a;
        t.set(r);
        this.a = r;
        break;
      } // OR.T
      case 0x4b: {
        const t = this.absIndirectTarget();
        const r = t.get() | this.a;
        t.set(r);
        this.a = r;
        break;
      } // OR.R
      case 0x4c:
        this.a = this.a ^ this.fetch8();
        break; // XRI
      case 0x4d:
        this.a = this.a ^ this.zpTarget().get();
        break; // XRZ
      case 0x4e:
        this.a = this.a ^ this.absTarget().get();
        break; // XRB
      case 0x4f:
        this.a = this.a ^ this.zpIndirectTarget().get();
        break; // XRT
      case 0x50:
        this.a = this.a ^ this.absIndirectTarget().get();
        break; // XRR
      case 0x51: {
        const t = this.zpTarget();
        const r = t.get() ^ this.a;
        t.set(r);
        this.a = r;
        break;
      } // XR.Z
      case 0x52: {
        const t = this.absTarget();
        const r = t.get() ^ this.a;
        t.set(r);
        this.a = r;
        break;
      } // XR.B
      case 0x53: {
        const t = this.zpIndirectTarget();
        const r = t.get() ^ this.a;
        t.set(r);
        this.a = r;
        break;
      } // XR.T
      case 0x54: {
        const t = this.absIndirectTarget();
        const r = t.get() ^ this.a;
        t.set(r);
        this.a = r;
        break;
      } // XR.R

      // ============================================================ 0x55-0x65: branches
      case 0x55:
        this.fastBranch(this.z === false);
        break; // FNE
      case 0x56:
        this.fastBranch(this.z === true);
        break; // FEQ
      case 0x57:
        this.fastBranch(this.c === false);
        break; // FCC
      case 0x58:
        this.fastBranch(this.c === true);
        break; // FCS
      case 0x59:
        this.fastBranch(this.n === false);
        break; // FPL
      case 0x5a:
        this.fastBranch(this.n === true);
        break; // FMI
      case 0x5b:
        this.fastBranch(this.c === true && this.z === false);
        break; // FGT (unsigned >)
      case 0x5c:
        this.fastBranch(this.c === false || this.z === true);
        break; // FLE (unsigned <=)
      case 0x5d:
        this.fastBranch(true);
        break; // FPA: unconditional fast jump
      case 0x5e:
        this.branch(this.z === false);
        break; // BNE
      case 0x5f:
        this.branch(this.z === true);
        break; // BEQ
      case 0x60:
        this.branch(this.c === false);
        break; // BCC
      case 0x61:
        this.branch(this.c === true);
        break; // BCS
      case 0x62:
        this.branch(this.n === false);
        break; // BPL
      case 0x63:
        this.branch(this.n === true);
        break; // BMI
      case 0x64:
        this.branch(this.c === true && this.z === false);
        break; // BGT
      case 0x65:
        this.branch(this.c === false || this.z === true);
        break; // BLE

      // ============================================================ 0x66-0x6f: jumps/subroutines/stack
      case 0x66: {
        // JPA: PC = addr
        const addr = this.fetch16();
        this.pc = addr;
        break;
      }
      case 0x67: {
        // JPR: PC = *addr  (addr holds a 2-byte pointer)
        const addr = this.fetch16();
        this.pc = this.mem.read16(addr);
        break;
      }
      case 0x68: {
        // JAR: PC = *(addr + A)
        const addr = this.fetch16();
        const lowSum = (addr & 0xff) + this.a;
        const target = (addr + this.a) & 0xffff;
        this.pc = this.mem.read16(target);
        this.setFlagsByte(lowSum & 0xff, lowSum > 0xff);
        break;
      }
      case 0x69: {
        // JPS: push return address, PC = addr (A left undefined -> unchanged)
        this.level++;
        const ret = this.pc; // points just past the operand, i.e. the following instruction
        const addr = this.fetch16();
        this.push8(ret & 0xff);
        this.push8((ret >> 8) & 0xff);
        this.pc = addr;
        // stack should be:
        // Offset:	 -2	 -1	 0	 1	 2	 3	 4	 5	(relative to SP)
        // Stack:	  ---	---	---	MSB	LSB	<A>	<B>	<C>

        break;
      }
      case 0x6a: {
        // JAS: same as JPS but explicitly A-preserving (we never touch A for JPS either)
        this.level++;
        const ret = this.pc;
        const addr = this.fetch16();
        this.push8(ret & 0xff);
        this.push8((ret >> 8) & 0xff);
        this.pc = addr;
        break;
      }
      case 0x6b: {
        // RTS
        const hi = this.pop8();
        const lo = this.pop8();
        this.pc = ((lo | (hi << 8)) + 2) & 0xffff; // +2 to skip the JPS/JAS operand
        this.level--;
        break;
      }
      case 0x6c: // PHS: push A
        this.push8(this.a);
        break;
      case 0x6d: // PLS: A = pull
        this.a = this.pop8();
        break;
      case 0x6e: {
        // LDS: A = *(0xff00 + SP + offset)
        const off = this.fetchSigned8();
        const addr = STACK_PAGE + ((this.getSp() + off) & 0xff);
        this.a = this.mem.read(addr);
        break;
      }
      case 0x6f: {
        // SDS: *(0xff00 + SP + offset) = A
        const off = this.fetchSigned8();
        const addr = STACK_PAGE + ((this.getSp() + off) & 0xff);
        this.mem.write(addr, this.a);
        break;
      }

      // ============================================================ 0x70-0x75: FLASH read/write
      case 0x70: {
        // RDB: A = FLASH[bank:addr]  (addr,bnk direct operands)
        const addr = this.fetch16();
        const bnk = this.fetch8();
        this.a = this.mem.flashTransferRead(bnk, addr);
        break;
      }
      case 0x71: {
        // RDR: A = FLASH[*(ptr+2) : **ptr]  (ptr = addr operand, holds addrLO,addrHI,bank)
        const ptrAddr = this.fetch16();
        const target = this.mem.read16(ptrAddr);
        const bank = this.mem.read((ptrAddr + 2) & 0xffff);
        this.a = this.mem.flashTransferRead(bank, target);
        break;
      }
      case 0x72: {
        // RAP: A = FLASH[bank : page<<8 + A]
        const page = this.fetch8();
        const bnk = this.fetch8();
        const windowAddr = ((page << 8) | this.a) & 0xffff;
        this.a = this.mem.flashTransferRead(bnk, windowAddr);
        break;
      }
      case 0x73: {
        // RZP: A = FLASH[bank : page<<8 + *Z]
        const zp = this.fetch8();
        const page = this.fetch8();
        const bnk = this.fetch8();
        const index = this.mem.read(zp);
        const windowAddr = ((page << 8) | index) & 0xffff;
        this.a = this.mem.flashTransferRead(bnk, windowAddr);
        break;
      }
      case 0x74: {
        // WDB: FLASH[bank:addr] = A
        const addr = this.fetch16();
        const bnk = this.fetch8();
        this.mem.flashTransferWrite(bnk, addr, this.a);
        break;
      }
      case 0x75: {
        // WDR: FLASH[*(ptr+2) : **ptr] = A
        const ptrAddr = this.fetch16();
        const target = this.mem.read16(ptrAddr);
        const bank = this.mem.read((ptrAddr + 2) & 0xffff);
        this.mem.flashTransferWrite(bank, target, this.a);
        break;
      }

      // ============================================================ 0x76-0x7e: load into A
      case 0x76:
        this.a = this.fetch8();
        break; // LDI
      case 0x77:
        this.a = this.zpTarget().get();
        break; // LDZ
      case 0x78:
        this.a = this.absTarget().get();
        break; // LDB
      case 0x79:
        this.a = this.zpIndirectTarget().get();
        break; // LDT
      case 0x7a:
        this.a = this.absIndirectTarget().get();
        break; // LDR
      case 0x7b: {
        // LAP: A = *(page<<8 + A)
        const page = this.fetch8();
        const addr = ((page << 8) | this.a) & 0xffff;
        this.a = this.mem.read(addr);
        break;
      }
      case 0x7c: {
        // LAB: A = *(addr + A)
        const addr = this.fetch16();
        const lowSum = (addr & 0xff) + this.a;
        const target = (addr + this.a) & 0xffff;
        this.a = this.mem.read(target);
        this.setFlagsByte(lowSum & 0xff, lowSum > 0xff);
        break;
      }
      case 0x7d: {
        // LZP: A = *(page<<8 + *Z)
        const zp = this.fetch8();
        const page = this.fetch8();
        const idx = this.mem.read(zp);
        const addr = ((page << 8) | idx) & 0xffff;
        this.a = this.mem.read(addr);
        break;
      }
      case 0x7e: {
        // LZB: A = *(addr + *Z)
        const zp = this.fetch8();
        const addr = this.fetch16();
        const idx = this.mem.read(zp);
        const lowSum = (addr & 0xff) + idx;
        const target = (addr + idx) & 0xffff;
        this.a = this.mem.read(target);
        this.setFlagsByte(lowSum & 0xff, lowSum > 0xff);
        break;
      }

      // ============================================================ 0x7f-0x83: store A
      case 0x7f:
        this.zpTarget().set(this.a);
        break; // SDZ
      case 0x80:
        this.absTarget().set(this.a);
        break; // SDB
      case 0x81:
        this.zpIndirectTarget().set(this.a);
        break; // SDT
      case 0x82:
        this.absIndirectTarget().set(this.a);
        break; // SDR
      case 0x83: {
        // SZP: *(page<<8 + *Z) = A
        const zp = this.fetch8();
        const page = this.fetch8();
        const idx = this.mem.read(zp);
        const addr = ((page << 8) | idx) & 0xffff;
        this.mem.write(addr, this.a);
        break;
      }

      // ============================================================ 0x84-0x9b: move family
      case 0x84: {
        const imm = this.fetch8();
        const t = this.zpTarget();
        t.set(imm);
        this.a = imm;
        break;
      } // MIZ
      case 0x85: {
        const imm = this.fetch8();
        const t = this.absTarget();
        t.set(imm);
        this.a = imm;
        break;
      } // MIB
      case 0x86: {
        const imm = this.fetch8();
        const t = this.zpIndirectTarget();
        t.set(imm);
        this.a = imm;
        break;
      } // MIT
      case 0x87: {
        const imm = this.fetch8();
        const t = this.absIndirectTarget();
        t.set(imm);
        this.a = imm;
        break;
      } // MIR
      case 0x88: {
        const imm = this.fetch16();
        const t = this.zpWordTarget();
        t.set16(imm);
        this.a = (imm >> 8) & 0xff;
        break;
      } // MIV
      case 0x89: {
        const imm = this.fetch16();
        const t = this.absWordTarget();
        t.set16(imm);
        this.a = (imm >> 8) & 0xff;
        break;
      } // MIW
      case 0x8a: {
        const s = this.zpTarget();
        const d = this.zpTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MZZ
      case 0x8b: {
        const s = this.zpTarget();
        const d = this.absTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MZB
      case 0x8c: {
        const s = this.zpTarget();
        const d = this.zpIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MZT
      case 0x8d: {
        const s = this.zpTarget();
        const d = this.absIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MZR
      case 0x8e: {
        const s = this.absTarget();
        const d = this.zpTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MBZ
      case 0x8f: {
        const s = this.absTarget();
        const d = this.absTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MBB
      case 0x90: {
        const s = this.absTarget();
        const d = this.zpIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MBT
      case 0x91: {
        const s = this.absTarget();
        const d = this.absIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MBR
      case 0x92: {
        const s = this.zpIndirectTarget();
        const d = this.zpTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MTZ
      case 0x93: {
        const s = this.zpIndirectTarget();
        const d = this.absTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MTB
      case 0x94: {
        const s = this.zpIndirectTarget();
        const d = this.zpIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MTT
      case 0x95: {
        const s = this.zpIndirectTarget();
        const d = this.absIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MTR
      case 0x96: {
        const s = this.absIndirectTarget();
        const d = this.zpTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MRZ
      case 0x97: {
        const s = this.absIndirectTarget();
        const d = this.absTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MRB
      case 0x98: {
        const s = this.absIndirectTarget();
        const d = this.zpIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MRT
      case 0x99: {
        const s = this.absIndirectTarget();
        const d = this.absIndirectTarget();
        const v = s.get();
        d.set(v);
        this.a = v;
        break;
      } // MRR
      case 0x9a: {
        const s = this.zpWordTarget();
        const d = this.zpWordTarget();
        const v = s.get16();
        d.set16(v);
        this.a = (v >> 8) & 0xff;
        break;
      } // MVV
      case 0x9b: {
        const s = this.absWordTarget();
        const d = this.zpWordTarget();
        const v = s.get16();
        d.set16(v);
        this.a = (v >> 8) & 0xff;
        break;
      } // MWV

      // ============================================================ 0x9c-0xa3: clear
      case 0x9c:
        this.a = 0;
        break; // CLD
      case 0x9d:
        this.zpTarget().set(0);
        break; // CLZ (A conserved)
      case 0x9e:
        this.absTarget().set(0);
        break; // CLB (A conserved)
      case 0x9f:
        this.zpWordTarget().set16(0);
        this.a = 0;
        break; // CLV
      case 0xa0:
        this.absWordTarget().set16(0);
        this.a = 0;
        break; // CLW
      case 0xa1:
        this.zpLongTarget().set32(0);
        this.a = 0;
        break; // CLQ
      case 0xa2:
        this.absLongTarget().set32(0);
        this.a = 0;
        break; // CLL
      case 0xa3: {
        // CL5: **Z = 0 (5 bytes), *Z += 5
        const zp = this.fetch8();
        const ptr = this.mem.read16(zp);
        for (let i = 0; i < 5; i++) this.mem.write((ptr + i) & 0xffff, 0);
        this.mem.write16(zp, (ptr + 5) & 0xffff);
        this.a = (ptr + 5) & 0xff;
        this.c = this.a == 0; // mirrors Z (result is always 0)
        break;
      }

      // ============================================================ 0xa4-0xaf: inc/dec
      case 0xa4: {
        const r = this.add8(this.a, 1, 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // INC
      case 0xa5: {
        const t = this.zpTarget();
        const r = this.add8(t.get(), 1, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // INZ
      case 0xa6: {
        const t = this.absTarget();
        const r = this.add8(t.get(), 1, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // INB
      case 0xa7: {
        const t = this.zpWordTarget();
        const r = this.add16(t.get16(), 1, 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // INV
      case 0xa8: {
        const t = this.absWordTarget();
        const r = this.add16(t.get16(), 1, 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // INW
      case 0xa9: {
        const t = this.zpLongTarget();
        t.set32(this.add32(t.get32(), 1));
        break;
      } // INQ (flags/A undefined -> unchanged)
      case 0xaa: {
        const r = this.sub8(this.a, 1, 1);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // DEC
      case 0xab: {
        const t = this.zpTarget();
        const r = this.sub8(t.get(), 1, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // DEZ
      case 0xac: {
        const t = this.absTarget();
        const r = this.sub8(t.get(), 1, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // DEB
      case 0xad: {
        const t = this.zpWordTarget();
        const r = this.sub16(t.get16(), 1, 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // DEV
      case 0xae: {
        const t = this.absWordTarget();
        const r = this.sub16(t.get16(), 1, 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // DEW
      case 0xaf: {
        const t = this.zpLongTarget();
        t.set32(this.sub32(t.get32(), 1));
        break;
      } // DEQ (undefined -> unchanged)

      // ============================================================ 0xb0-0xcb: add family
      case 0xb0: {
        const r = this.add8(this.a, this.fetch8(), 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ADI
      case 0xb1: {
        const r = this.add8(this.a, this.zpTarget().get(), 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ADZ
      case 0xb2: {
        const r = this.add8(this.a, this.absTarget().get(), 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ADB
      case 0xb3: {
        const r = this.add8(this.a, this.zpIndirectTarget().get(), 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ADT
      case 0xb4: {
        const r = this.add8(this.a, this.absIndirectTarget().get(), 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ADR
      case 0xb5: {
        const t = this.zpTarget();
        const r = this.add8(t.get(), this.a, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AD.Z
      case 0xb6: {
        const t = this.absTarget();
        const r = this.add8(t.get(), this.a, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AD.B
      case 0xb7: {
        const t = this.zpIndirectTarget();
        const r = this.add8(t.get(), this.a, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AD.T
      case 0xb8: {
        const t = this.absIndirectTarget();
        const r = this.add8(t.get(), this.a, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AD.R
      case 0xb9: {
        const t = this.zpWordTarget();
        const r = this.add16(t.get16(), this.a, 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // ADV
      case 0xba: {
        const t = this.absWordTarget();
        const r = this.add16(t.get16(), this.a, 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // ADW
      case 0xbb: {
        const t = this.zpLongTarget();
        t.set32(this.add32(t.get32(), this.a));
        break;
      } // ADQ (undefined -> unchanged)
      case 0xbc: {
        const imm = this.fetch8();
        const t = this.zpTarget();
        const r = this.add8(t.get(), imm, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AIZ
      case 0xbd: {
        const imm = this.fetch8();
        const t = this.absTarget();
        const r = this.add8(t.get(), imm, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AIB
      case 0xbe: {
        const imm = this.fetch8();
        const t = this.zpIndirectTarget();
        const r = this.add8(t.get(), imm, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AIT
      case 0xbf: {
        const imm = this.fetch8();
        const t = this.absIndirectTarget();
        const r = this.add8(t.get(), imm, 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AIR
      case 0xc0: {
        const imm = this.fetch8();
        const t = this.zpWordTarget();
        const r = this.add16(t.get16(), imm, 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // AIV (A := LSB!)
      case 0xc1: {
        const imm = this.fetch8();
        const t = this.absWordTarget();
        const r = this.add16(t.get16(), imm, 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // AIW
      case 0xc2: {
        const imm = this.fetch8();
        const t = this.zpLongTarget();
        t.set32(this.add32(t.get32(), imm));
        break;
      } // AIQ (undefined -> unchanged)
      case 0xc3: {
        const s = this.zpTarget();
        const t = this.zpTarget();
        const r = this.add8(t.get(), s.get(), 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AZZ
      case 0xc4: {
        const s = this.zpTarget();
        const t = this.zpIndirectTarget();
        const r = this.add8(t.get(), s.get(), 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AZT
      case 0xc5: {
        const s = this.zpTarget();
        const t = this.zpWordTarget();
        const r = this.add16(t.get16(), s.get(), 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // AZV (A := LSB!)
      case 0xc6: {
        const s = this.zpTarget();
        const t = this.zpLongTarget();
        t.set32(this.add32(t.get32(), s.get()));
        break;
      } // AZQ (undefined -> unchanged)
      case 0xc7: {
        const s = this.absTarget();
        const t = this.absTarget();
        const r = this.add8(t.get(), s.get(), 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ABB
      case 0xc8: {
        const s = this.absTarget();
        const t = this.absWordTarget();
        const r = this.add16(t.get16(), s.get(), 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // ABW
      case 0xc9: {
        const s = this.zpIndirectTarget();
        const t = this.zpTarget();
        const r = this.add8(t.get(), s.get(), 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ATZ
      case 0xca: {
        const s = this.zpIndirectTarget();
        const t = this.zpIndirectTarget();
        const r = this.add8(t.get(), s.get(), 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ATT
      case 0xcb: {
        const s = this.zpWordTarget();
        const t = this.zpWordTarget();
        const r = this.add16(t.get16(), s.get16(), 0);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // AVV

      // ============================================================ 0xcc-0xe7: sub family
      case 0xcc: {
        const r = this.sub8(this.a, this.fetch8(), 1);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SUI
      case 0xcd: {
        const r = this.sub8(this.a, this.zpTarget().get(), 1);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SUZ
      case 0xce: {
        const r = this.sub8(this.a, this.absTarget().get(), 1);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SUB
      case 0xcf: {
        const r = this.sub8(this.a, this.zpIndirectTarget().get(), 1);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SUT
      case 0xd0: {
        const r = this.sub8(this.a, this.absIndirectTarget().get(), 1);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SUR
      case 0xd1: {
        const t = this.zpTarget();
        const r = this.sub8(t.get(), this.a, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SU.Z
      case 0xd2: {
        const t = this.absTarget();
        const r = this.sub8(t.get(), this.a, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SU.B
      case 0xd3: {
        const t = this.zpIndirectTarget();
        const r = this.sub8(t.get(), this.a, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SU.T
      case 0xd4: {
        const t = this.absIndirectTarget();
        const r = this.sub8(t.get(), this.a, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SU.R
      case 0xd5: {
        const t = this.zpWordTarget();
        const r = this.sub16(t.get16(), this.a, 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // SUV
      case 0xd6: {
        const t = this.absWordTarget();
        const r = this.sub16(t.get16(), this.a, 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // SUW
      case 0xd7: {
        const t = this.zpLongTarget();
        t.set32(this.sub32(t.get32(), this.a));
        break;
      } // SUQ (undefined -> unchanged)
      case 0xd8: {
        const imm = this.fetch8();
        const t = this.zpTarget();
        const r = this.sub8(t.get(), imm, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SIZ
      case 0xd9: {
        const imm = this.fetch8();
        const t = this.absTarget();
        const r = this.sub8(t.get(), imm, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SIB
      case 0xda: {
        const imm = this.fetch8();
        const t = this.zpIndirectTarget();
        const r = this.sub8(t.get(), imm, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SIT
      case 0xdb: {
        const imm = this.fetch8();
        const t = this.absIndirectTarget();
        const r = this.sub8(t.get(), imm, 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SIR
      case 0xdc: {
        const imm = this.fetch8();
        const t = this.zpWordTarget();
        const r = this.sub16(t.get16(), imm, 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // SIV (A := LSB!)
      case 0xdd: {
        const imm = this.fetch8();
        const t = this.absWordTarget();
        const r = this.sub16(t.get16(), imm, 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // SIW
      case 0xde: {
        const imm = this.fetch8();
        const t = this.zpLongTarget();
        t.set32(this.sub32(t.get32(), imm));
        break;
      } // SIQ (undefined -> unchanged)
      case 0xdf: {
        const s = this.zpTarget();
        const t = this.zpTarget();
        const r = this.sub8(t.get(), s.get(), 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SZZ
      case 0xe0: {
        const s = this.zpTarget();
        const t = this.zpIndirectTarget();
        const r = this.sub8(t.get(), s.get(), 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SZT
      case 0xe1: {
        const s = this.zpTarget();
        const t = this.zpWordTarget();
        const r = this.sub16(t.get16(), s.get(), 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // SZV (A := LSB!)
      case 0xe2: {
        const s = this.zpTarget();
        const t = this.zpLongTarget();
        t.set32(this.sub32(t.get32(), s.get()));
        break;
      } // SZQ (undefined -> unchanged)
      case 0xe3: {
        const s = this.absTarget();
        const t = this.absTarget();
        const r = this.sub8(t.get(), s.get(), 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SBB
      case 0xe4: {
        const s = this.absTarget();
        const t = this.absWordTarget();
        const r = this.sub16(t.get16(), s.get(), 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // SBW
      case 0xe5: {
        const s = this.zpIndirectTarget();
        const t = this.zpTarget();
        const r = this.sub8(t.get(), s.get(), 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // STZ
      case 0xe6: {
        const s = this.zpIndirectTarget();
        const t = this.zpIndirectTarget();
        const r = this.sub8(t.get(), s.get(), 1);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // STT
      case 0xe7: {
        const s = this.zpWordTarget();
        const t = this.zpWordTarget();
        const r = this.sub16(t.get16(), s.get16(), 1);
        t.set16(r.result);
        this.a = (r.result >> 8) & 0xff;
        this.setFlagsWordMsb(r.result, r.carry);
        break;
      } // SVV

      // ============================================================ 0xe8-0xf8: compare family
      case 0xe8: {
        const r = this.sub8(this.a, this.fetch8(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CPI (A unchanged)
      case 0xe9: {
        const r = this.sub8(this.a, this.zpTarget().get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CPZ
      case 0xea: {
        const r = this.sub8(this.a, this.absTarget().get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CPB
      case 0xeb: {
        const r = this.sub8(this.a, this.zpIndirectTarget().get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CPT
      case 0xec: {
        const r = this.sub8(this.a, this.absIndirectTarget().get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CPR
      case 0xed: {
        const imm = this.fetch8();
        const t = this.zpTarget();
        const tv = t.get();
        this.a = tv;
        const r = this.sub8(tv, imm, 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CIZ
      case 0xee: {
        const imm = this.fetch8();
        const t = this.absTarget();
        const tv = t.get();
        this.a = tv;
        const r = this.sub8(tv, imm, 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CIB
      case 0xef: {
        const imm = this.fetch8();
        const t = this.zpIndirectTarget();
        const tv = t.get();
        this.a = tv;
        const r = this.sub8(tv, imm, 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CIT
      case 0xf0: {
        const imm = this.fetch8();
        const t = this.absIndirectTarget();
        const tv = t.get();
        this.a = tv;
        const r = this.sub8(tv, imm, 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CIR
      case 0xf1: {
        const imm = this.fetch16();
        const t = this.zpWordTarget();
        const r = this.sub16(t.get16(), imm, 1);
        this.setFlagsWord16(r.result, r.carry);
        break;
      } // CIV (A unchanged)
      case 0xf2: {
        const imm = this.fetch16();
        const t = this.absWordTarget();
        const r = this.sub16(t.get16(), imm, 1);
        this.setFlagsWord16(r.result, r.carry);
        break;
      } // CIW
      case 0xf3: {
        const t1 = this.zpTarget();
        const t2 = this.zpTarget();
        const v2 = t2.get();
        this.a = v2;
        const r = this.sub8(v2, t1.get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CZZ
      case 0xf4: {
        const t1 = this.zpTarget();
        const t2 = this.zpIndirectTarget();
        const v2 = t2.get();
        this.a = v2;
        const r = this.sub8(v2, t1.get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CZT
      case 0xf5: {
        const t1 = this.absTarget();
        const t2 = this.absTarget();
        const v2 = t2.get();
        this.a = v2;
        const r = this.sub8(v2, t1.get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CBB
      case 0xf6: {
        const t1 = this.zpIndirectTarget();
        const t2 = this.zpTarget();
        const v2 = t2.get();
        this.a = v2;
        const r = this.sub8(v2, t1.get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CTZ
      case 0xf7: {
        const t1 = this.zpIndirectTarget();
        const t2 = this.zpIndirectTarget();
        const v2 = t2.get();
        this.a = v2;
        const r = this.sub8(v2, t1.get(), 1);
        this.setFlagsByte(r.result, r.carry);
        break;
      } // CTT
      case 0xf8: {
        const t1 = this.zpWordTarget();
        const t2 = this.zpWordTarget();
        const r = this.sub16(t2.get16(), t1.get16(), 1);
        this.setFlagsWord16(r.result, r.carry);
        break;
      } // CVV (A unchanged)

      // ============================================================ 0xf9-0xfe: add/sub with carry
      case 0xf9: {
        const r = this.add8(this.a, this.fetch8(), this.c ? 1 : 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ACI
      case 0xfa: {
        const r = this.add8(this.a, this.zpTarget().get(), this.c ? 1 : 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // ACZ
      case 0xfb: {
        const t = this.zpTarget();
        const r = this.add8(t.get(), this.a, this.c ? 1 : 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // AC.Z
      case 0xfc: {
        const r = this.sub8(this.a, this.fetch8(), this.c ? 1 : 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SCI
      case 0xfd: {
        const r = this.sub8(this.a, this.zpTarget().get(), this.c ? 1 : 0);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SCZ
      case 0xfe: {
        const t = this.zpTarget();
        const r = this.sub8(t.get(), this.a, this.c ? 1 : 0);
        t.set(r.result);
        this.a = r.result;
        this.setFlagsByte(r.result, r.carry);
        break;
      } // SC.Z

      case 0xff:
        this.mem.bank = 0xff;
        break;

      default:
        // Exhaustive by construction (0x00-0xff); kept for TypeScript's benefit.
        break;
    }
    return cycles[op];
  }

  // ---------------------------------------------------------------------------------
  // Shift/rotate primitives shared by the 0x05-0x2d opcode block
  // ---------------------------------------------------------------------------------

  private shiftLeftLogical(value: number, steps: number): number {
    let result = value;
    let carry = false;
    for (let i = 0; i < steps; i++) {
      carry = (result & 0x80) !== 0;
      result = (result << 1) & 0xff;
    }
    this.setFlagsByte(result, carry);
    return result;
  }
  private shiftRightLogical(value: number, steps: number): number {
    let result = value;
    let carry = false;
    for (let i = 0; i < steps; i++) {
      carry = (result & 0x01) !== 0;
      result = (result >> 1) & 0xff;
    }
    this.setFlagsByte(result, carry);
    return result;
  }
  private rotateLeftThroughCarry(value: number, steps: number): number {
    let result = value;
    let carry = this.c;
    for (let i = 0; i < steps; i++) {
      const newCarry = (result & 0x80) !== 0;
      result = ((result << 1) | (carry ? 1 : 0)) & 0xff;
      carry = newCarry;
    }
    this.setFlagsByte(result, carry);
    return result;
  }
  private rotateRightThroughCarry(value: number, steps: number): number {
    let result = value;
    let carry = this.c;
    for (let i = 0; i < steps; i++) {
      const newCarry = (result & 0x01) !== 0;
      result = ((result >> 1) | (carry ? 0x80 : 0)) & 0xff;
      carry = newCarry;
    }
    this.setFlagsByte(result, carry);
    return result;
  }

  private shiftLeftLogicalFlagged(value: number): AddResult {
    const carry = (value & 0x80) !== 0;
    return { result: (value << 1) & 0xff, carry };
  }
  private shiftRightLogicalFlagged(value: number): AddResult {
    const carry = (value & 0x01) !== 0;
    return { result: (value >> 1) & 0xff, carry };
  }
  private rotateLeftFlagged(value: number): AddResult {
    const carry = (value & 0x80) !== 0;
    return { result: ((value << 1) | (this.c ? 1 : 0)) & 0xff, carry };
  }
  private rotateRightFlagged(value: number): AddResult {
    const carry = (value & 0x01) !== 0;
    return { result: ((value >> 1) | (this.c ? 0x80 : 0)) & 0xff, carry };
  }
  private shiftLeftWord(value: number): AddResult {
    const carry = (value & 0x8000) !== 0;
    return { result: (value << 1) & 0xffff, carry };
  }
  private rotateLeftWord(value: number): AddResult {
    const carry = (value & 0x8000) !== 0;
    return { result: ((value << 1) | (this.c ? 1 : 0)) & 0xffff, carry };
  }
  private shiftLeftLong(value: number): { result: number; topByte: number; carry: boolean } {
    const carry = (value & 0x80000000) !== 0;
    const result = (value << 1) >>> 0;
    return { result, topByte: (result >>> 24) & 0xff, carry };
  }
  private rotateLeftLong(value: number): { result: number; topByte: number; carry: boolean } {
    const carry = (value & 0x80000000) !== 0;
    const result = (((value << 1) >>> 0) | (this.c ? 1 : 0)) >>> 0;
    return { result, topByte: (result >>> 24) & 0xff, carry };
  }

  private fastBranch(cond: boolean): void {
    const lsb = this.fetch8();
    if (cond) this.pc = (this.pc & 0xff00) | lsb;
  }
  private branch(cond: boolean): void {
    const addr = this.fetch16();
    if (cond) this.pc = addr;
  }
}

const cycles = [
  16, 160, 3, 4, 6, 2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5, 6, 7, 8, 9, 10, 2, 10, 15, 15, 15, 15, 13, 5, 4, 6, 6, 8, 10, 12, 11, 13, 4, 6, 6, 8,
  10, 12, 11, 13, 4, 5, 7, 7, 9, 11, 4, 5, 7, 7, 9, 11, 3, 4, 6, 7, 9, 4, 6, 7, 9, 3, 4, 6, 7, 9, 4, 6, 7, 9, 7, 8, 10, 11, 13, 7, 10, 10, 13,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 7, 9, 11, 14, 10, 8, 6, 6, 11, 8, 11, 7, 9, 14, 16, 2, 3, 5, 6, 8, 4, 7, 6, 9, 3, 5, 6,
  8, 6, 4, 6, 7, 9, 6, 13, 5, 7, 8, 10, 7, 9, 10, 12, 8, 10, 11, 13, 10, 12, 13, 15, 7, 9, 3, 4, 6, 4, 7, 6, 11, 16, 3, 5, 7, 7, 9, 11, 3, 5, 7,
  7, 9, 11, 3, 4, 6, 7, 9, 4, 6, 7, 9, 7, 9, 11, 5, 7, 8, 10, 8, 10, 12, 6, 9, 9, 13, 10, 13, 9, 12, 14, 3, 4, 6, 7, 9, 5, 7, 8, 10, 8, 10, 12,
  5, 7, 8, 10, 8, 10, 12, 6, 9, 9, 13, 10, 13, 9, 12, 14, 3, 4, 6, 7, 9, 5, 7, 8, 10, 12, 16, 6, 9, 10, 9, 14, 14, 3, 4, 4, 3, 4, 5, 0,
];
