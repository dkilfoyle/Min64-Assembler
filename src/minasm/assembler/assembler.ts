import {
  Data,
  isBinaryExpression,
  isByteLiteral,
  isCharLiteral,
  isLabelReference,
  isStringLiteral,
  isWordLiteral,
  type Directive,
  type Instruction,
  type Operand,
  type Program,
} from "../ls/generated/ast";
import { instructionInfo } from "./instructionInfo";

interface IRecord {
  bytes: Uint8Array;
  address: number;
}

class IntelHex {
  public records: Array<IRecord> = [];
  public buffer: Array<number> = [];
  public address = 0;
  reset() {
    this.records = [];
    this.buffer = [];
    this.address = 0;
  }
  setAddress(addr: number) {
    if (addr < 0 || addr > 0xffff) throw Error("Address must be between 0 and 0xffff");
    if (this.buffer.length > 0) {
      this.records.push({ bytes: new Uint8Array(this.buffer), address: this.address });
      this.buffer = [];
    }
    this.address = addr;
  }
  emit(mc: number, bytes: Uint8Array) {
    if (bytes.length == 0) return;
    for (let i = 0; i < bytes.length; i++) {
      this.buffer.push(bytes[i]);
      if (this.buffer.length == 16) {
        this.records.push({ bytes: new Uint8Array(this.buffer), address: this.address });
        this.buffer = [];
        this.address += 16;
      }
    }
  }
  toString(): string {
    if (this.buffer.length > 0) {
      this.records.push({ bytes: new Uint8Array(this.buffer), address: this.address });
      this.buffer = [];
    }
    let hex = "";
    for (const record of this.records) {
      let checksum = record.bytes.reduce((acc, byte) => acc + byte, 0);
      checksum += record.bytes.length + (record.address >> 8) + (record.address & 0xff);
      hex += `:${record.bytes.length.toString(16).padStart(2, "0")}${record.address.toString(16).padStart(4, "0")}00`;
      for (const byte of record.bytes) {
        hex += byte.toString(16).padStart(2, "0");
      }
      checksum = -checksum & 0xff;
      hex += checksum.toString(16).padStart(2, "0");
      hex += "\n";
    }
    return hex.toUpperCase();
  }
}

class Assembler {
  public mc = 0x2000;
  public pc = 0x2000;
  public isEmit = true;
  labels: Map<string, number> = new Map();
  hex: IntelHex = new IntelHex();

  reset() {
    this.mc = 0x2000;
    this.pc = 0x2000;
    this.isEmit = true;
    this.labels.clear();
    this.hex.reset();
  }

  emit(bytes: Uint8Array) {
    if (this.isEmit) {
      this.hex.emit(this.mc, bytes);
      this.mc += bytes.length;
    }
    this.pc += bytes.length;
  }

  assemble(ast: Program): Uint8Array {
    this.reset();

    const advance = (numBytes: number) => {
      if (this.isEmit) this.mc += numBytes;
      this.pc += numBytes;
    };

    // First pass: process directives and instructions to set up memory and program counter
    for (const entry of ast.entries) {
      if (entry.directive) {
        this.processDirective(entry.directive);
      } else if (entry.instruction) {
        advance(this.calculateInstructionSize(entry.instruction));
      } else if (entry.data) {
        advance(this.calculateDataSize(entry.data));
      } else if (entry.label) {
        this.labels.set(entry.label.name, this.pc);
      }
    }

    // Second pass: generate machine code
    this.mc = 0x2000;
    this.pc = 0x2000;
    this.isEmit = true;

    for (const entry of ast.entries) {
      if (entry.directive) {
        this.processDirective(entry.directive);
      } else if (entry.instruction) {
        this.emitInstruction(entry.instruction);
      } else if (entry.data) {
        this.emitData(entry.data);
      } else if (entry.label) {
        // do nothing
      }
    }
    return new Uint8Array(0);
  }

  processDirective(dir: Directive): void {
    switch (dir.dir) {
      case "#emit":
        this.isEmit = true;
        break;
      case "#mute":
        this.isEmit = false;
        break;
      case "#page":
        this.mc = (this.mc + 0x100) & 0xff00;
        break;
      case "#org":
        if (dir.address !== undefined) {
          this.pc = dir.address;
          if (this.isEmit) {
            this.mc = this.pc;
            this.hex.setAddress(this.mc);
          }
        } else throw Error("#org directive needs address");
    }
  }

  calculateInstructionSize(instr: Instruction): number {
    const argSize = (args: number) => {
      switch (args) {
        case 0:
          return 0; // No arguments
        case 1:
        case 2:
        case 4:
          return 1;
        case 3:
          return 2;
        default:
          throw new Error(`Unknown argument size: ${args}`);
      }
    };
    const args = instructionInfo[instr.op].args;
    let size = 1; // Base size for the opcode
    size += argSize(args & 0x0f); // Size for the first argument
    size += argSize((args & 0xf0) >> 4); // Size for the second argument
    return size;
  }

  calculateDataSize(data: Data): number {
    let size = 0;
    for (const item of data.items) {
      if (isByteLiteral(item)) size += 1;
      else if (isWordLiteral(item)) size += 2;
      else if (isCharLiteral(item)) size += 1;
      else if (isStringLiteral(item)) size += item.value.length;
      else throw new Error(`Unknown data item type: ${item}`);
    }
    return size;
  }

  emitData(data: Data): void {
    for (const item of data.items) {
      if (isByteLiteral(item)) this.emit(new Uint8Array([item.value & 0xff]));
      else if (isWordLiteral(item)) this.emit(new Uint8Array([item.value & 0xff, (item.value >> 8) & 0xff]));
      else if (isCharLiteral(item)) this.emit(new Uint8Array([item.value.charCodeAt(0) & 0xff]));
      else if (isStringLiteral(item)) {
        const bytes: number[] = [];
        for (let i = 0; i < item.value.length; i++) {
          bytes.push(item.value.charCodeAt(i) & 0xff);
        }
        this.emit(new Uint8Array(bytes));
      } else throw new Error(`Unknown data item type: ${item}`);
    }
  }

  emitInstruction(instr: Instruction): void {
    const info = instructionInfo[instr.op];
    const bytes = [info.opcode];
    instr.operands.forEach((operand, i) => bytes.push(...this.processOperand(operand, i == 0 ? info.args & 0x0f : (info.args & 0xf0) >> 4)));
    this.emit(new Uint8Array(bytes));
  }

  processOperand(operand: Operand, expected: number): number[] {
    switch (expected) {
      case 0: // No argument
        return [];
      case 1: // 8-bit immediate
      case 2: {
        // Zero-page address
        const value = this.processExpression(operand);
        if (value < 0 || value > 0xff) throw new Error(`Expected 8-bit value, got ${value}`);
        return [value & 0xff];
      }
      case 3: {
        // 16-bit word
        const value = this.processExpression(operand);
        if (value < 0 || value > 0xffff) throw new Error(`Expected 16-bit value, got ${value}`);
        return [value & 0xff, (value >> 8) & 0xff];
      }
      case 4: {
        // fast jump
        const value = this.processExpression(operand);
        return [value & 0xff]; // lsb
      }
      default:
        throw new Error(`Unknown operand type: ${expected}`);
    }
  }

  processExpression(expr: Operand): number {
    if (isByteLiteral(expr)) return expr.value;
    else if (isWordLiteral(expr)) return expr.value;
    else if (isCharLiteral(expr)) return expr.value.charCodeAt(0);
    else if (isLabelReference(expr)) {
      const labelName = expr.label.ref?.name;
      if (!labelName) throw new Error("Label reference has no name");
      const address = this.labels.get(labelName);
      if (address === undefined) throw new Error(`Undefined label: ${labelName}`);
      if (expr.byteSelector === "<") return address & 0xff;
      else if (expr.byteSelector === ">") return (address >> 8) & 0xff;
      else return address;
    }
    if (isBinaryExpression(expr)) {
      // Handle binary expressions (e.g., label + offset)
      const left = this.processExpression(expr.left);
      const right = this.processExpression(expr.right);
      switch (expr.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        default:
          throw new Error(`Unknown binary operator: ${expr.operator}`);
      }
    } else throw new Error(`Unknown expression type: ${expr}`);
  }
}

export const assembler = new Assembler();
