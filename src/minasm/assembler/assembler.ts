import {
  Data,
  Expression,
  isBinaryExpression,
  isData,
  isDirective,
  isImmediateByteLiteral,
  isImmediateWordLiteral,
  isInstruction,
  isLabel,
  isLabelReference,
  isMenmonicLiteral,
  isStarLiteral,
  isStringLiteral,
  isUnaryExpression,
  Label,
  type Directive,
  type Instruction,
  type Program,
} from "../ls/generated/ast";
import { instructionInfo } from "./instructionInfo";
import { getExpressionSize } from "./utils";

interface IRecord {
  bytes: Uint8Array;
  address: number;
}

const FIRST_PASS = 1;
const SECOND_PASS = 2;

class IntelHex {
  public records: Array<IRecord> = [];
  public buffer: Array<number> = [];
  public address = 0;
  reset(initialAddress: number) {
    this.records = [];
    this.buffer = [];
    this.address = initialAddress;
  }
  flush() {
    if (this.buffer.length > 0) {
      this.records.push({ bytes: new Uint8Array(this.buffer), address: this.address });
      this.buffer = [];
    }
  }
  setAddress(addr: number) {
    if (addr < 0 || addr > 0xffff) throw Error("Address must be between 0 and 0xffff");
    this.flush();
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
  replaceValue(mc: number, value: number, size: number) {
    const recordIndex = this.records.findIndex((r) => mc >= r.address && mc < r.address + r.bytes.length);
    // replace the lo byte
    let r = this.records[recordIndex];
    const offset = mc - r.address;
    r.bytes[offset] = value & 0xff;

    if (size == 2) {
      // replace the hi byte
      let offset = mc + 1 - r.address;
      if (offset > r.bytes.length - 1) {
        r = this.records[recordIndex + 1];
        offset = 0;
      }
      r.bytes[offset] = (value >> 8) & 0xff;
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
    hex += ":00000001FF\n";
    return hex.toUpperCase();
  }
  debug() {
    this.records.forEach((r) => {
      console.log(
        `0x${r.address.toString(16).padStart(4, "0")}: `,
        Array.from(r.bytes).map((x) => x.toString(16).padStart(2, "0")),
      );
    });
  }
}

class Assembler {
  public mc = 0x2000;
  public pc = 0x2000;
  public isEmit = true;
  labels: Map<string, number> = new Map();
  hex: IntelHex = new IntelHex();
  curInstr: Instruction | null = null;
  locations: Map<number, { offset?: number; length?: number }> = new Map();

  reset(pass: 1 | 2) {
    this.mc = 0x2000;
    this.pc = 0x2000;
    this.isEmit = true;
    this.curInstr = null;
    if (pass == 2) this.hex.reset(0x2000);
    if (pass == 1) this.labels.clear();
  }

  emitByte(x: number) {
    if (this.isEmit) {
      this.hex.emit(this.mc, new Uint8Array([x]));
      this.mc += 1;
    }
    this.pc += 1;
  }

  emitWord(x: number) {
    if (this.isEmit) {
      this.hex.emit(this.mc, new Uint8Array([x & 0xff, (x >> 8) & 0xff]));
      this.mc += 2;
    }
    this.pc += 2;
  }

  advanceBytes(x: number) {
    if (this.isEmit) {
      this.mc += x;
    }
    this.pc += x;
  }

  assemble(ast: Program) {
    this.reset(FIRST_PASS);

    // First pass: process directives and instructions to set up memory and program counter
    for (const entry of ast.entries) {
      if (isDirective(entry)) this.processDirective(entry);
      else if (isLabel(entry)) this.processLabel(entry);
      else if (isInstruction(entry)) this.processInstruction(entry);
      else if (isData(entry)) {
        if (this.curInstr) this.processArgs(entry);
        else this.processData(entry);
      }
    }

    // dump label calculated in first pass
    // (Array.from(this.labels).map(([lbl, addr]) => console.log(`0x${addr.toString(16).padStart(4, "0")} ${lbl}`)), this.hex.debug());

    this.reset(SECOND_PASS);

    // Second pass: processExpressions and emit bytes
    for (const entry of ast.entries) {
      if (isDirective(entry)) this.processDirective(entry);
      else if (isInstruction(entry)) this.emitInstruction(entry);
      else if (isData(entry)) {
        if (this.curInstr) this.emitArgs(entry);
        else this.emitData(entry);
      }
    }
  }

  processDirective(dir: Directive): void {
    const setAddress = (addr: number) => {
      if (addr < 0 || addr > 0xffff) throw Error("Address must be between 0 and 0xffff");
      this.pc = addr;
      if (this.isEmit) {
        this.mc = this.pc;
        this.hex.setAddress(this.mc);
      }
    };

    switch (dir.dir) {
      case "#emit":
        this.isEmit = true;
        break;
      case "#mute":
        this.isEmit = false;
        break;
      case "#page":
        setAddress((this.pc + 0xff) & 0xff00);
        break;
      case "#org":
        if (dir.address !== undefined) {
          setAddress(dir.address);
        } else throw Error("#org directive needs address");
    }
  }

  processLabel(label: Label) {
    this.labels.set(label.name, this.pc);
  }

  processInstruction(instr: Instruction) {
    const info = instructionInfo[instr.op];
    this.advanceBytes(1);
    if (info.argSize.length) this.curInstr = instr; // the next Data will be arguments for this instruction
  }

  processArgs(data: Data) {
    // found the instruction arguments (Data) - check match expected and consume
    const info = instructionInfo[this.curInstr!.op];
    let size = 0;
    let dataIndex = 0;
    for (let argIndex = 0; argIndex < info.argType.length; argIndex++) {
      const expectedArgType = info.argType[argIndex];
      const expectedArgSize = info.argSize[argIndex];
      const isLSB = expectedArgType == 2 || expectedArgType == 4;
      const curDataItem = data.items[dataIndex++];
      const curDataSize = getExpressionSize(curDataItem);

      if (expectedArgSize == 1) {
        if (curDataSize == 1 || isLSB) {
          size += 1;
        } else {
          throw Error(`Invalid args for entry ${data.$containerIndex}`);
        }
      } else if (expectedArgSize == 2) {
        if (curDataSize == 1) {
          const nextDataItem = data.items[dataIndex++];
          const nextDataSize = getExpressionSize(nextDataItem);
          if (nextDataSize !== 1) throw Error("expectedArgSize is 2 and should have received two consecutive bytes");
          size += 2; // 2 consecutive bytes
        } else if (curDataSize == 2) {
          size += 2;
        } else throw Error(`Invalid data item size ${curDataSize} at entry ${data.$containerIndex}`);
      }
    }

    if (dataIndex != data.items.length) throw Error(`More data items than expected arguments`);
    if (size != info.totalSize) throw Error("Data does not match expected argument size");
    this.advanceBytes(size);
    this.curInstr = null;
  }

  processData(data: Data) {
    let size = 0;
    for (const item of data.items) {
      size += getExpressionSize(item);
    }
    this.advanceBytes(size);
  }

  emitInstruction(instr: Instruction) {
    const info = instructionInfo[instr.op];
    this.emitByte(info.opcode);
    if (info.argType.length) this.curInstr = instr;
  }

  emitArgs(data: Data) {
    // found the instruction arguments (Data) - emit them applying LSB where expected
    const info = instructionInfo[this.curInstr!.op];
    let dataIndex = 0;
    for (let argIndex = 0; argIndex < info.argType.length; argIndex++) {
      const expectedArgSize = info.argSize[argIndex];
      const curDataItem = data.items[dataIndex++];
      const curDataResult = this.calculateExpression(curDataItem);

      if (expectedArgSize == 1) {
        this.emitByte(curDataResult.result & 0xff);
      } else if (expectedArgSize == 2) {
        if (curDataResult.size == 1) {
          const nextDataItem = data.items[dataIndex++];
          const nextDataResult = this.calculateExpression(nextDataItem);
          this.emitByte(curDataResult.result);
          this.emitByte(nextDataResult.result);
        } else if (curDataResult.size == 2) {
          this.emitWord(curDataResult.result);
        }
      }
    }
    this.curInstr = null;
  }

  emitData(data: Data): void {
    for (const item of data.items) {
      if (isStringLiteral(item) && item.value.length > 1) {
        // "....."
        item.value.split("").forEach((x) => this.emitByte(x.charCodeAt(0)));
      } else {
        const curDataResult = this.calculateExpression(item);
        if (curDataResult.size == 1) this.emitByte(curDataResult.result);
        else if (curDataResult.size == 2) this.emitWord(curDataResult.result);
        else throw Error("Unknown data result size");
      }
    }
  }

  calculateExpression(expr: Expression): { result: number; size: number } {
    if (isBinaryExpression(expr)) {
      // Handle binary expressions (e.g., label + offset)
      const left = this.calculateExpression(expr.left);
      const right = this.calculateExpression(expr.right);
      let x: number;
      switch (expr.operator) {
        case "+":
          x = left.result + right.result;
          break;
        case "-":
          x = left.result - right.result;
          break;
        default:
          throw new Error(`Unknown binary operator: ${expr}`);
      }
      return { result: x, size: Math.max(left.size, right.size) };
    } else if (isUnaryExpression(expr)) {
      let x = this.calculateExpression(expr.expr).result;
      if (expr.operator == "<") return { result: x & 0xff, size: 1 };
      else return { result: (x >> 8) & 0xff, size: 1 };
    } else if (isStringLiteral(expr)) {
      if (expr.value.length != 1) throw Error(`processExpression should only be char literal`);
      return { result: expr.value.charCodeAt(0), size: 1 };
    } else if (isImmediateByteLiteral(expr)) {
      return { result: expr.neg ? -expr.value : expr.value, size: 1 };
    } else if (isImmediateWordLiteral(expr)) {
      return { result: expr.neg ? -expr.value : expr.value, size: 2 };
    } else if (isMenmonicLiteral(expr)) {
      return { result: instructionInfo[expr.value].opcode, size: 1 };
    } else if (isLabelReference(expr)) {
      const labelName = expr.label.ref?.name;
      if (!labelName) throw new Error("Label reference has no name");
      const address = this.labels.get(labelName);
      if (address === undefined) throw new Error(`Undefined label: ${labelName}`);
      return { result: address, size: 2 };
    } else if (isStarLiteral(expr)) {
      return { result: this.mc, size: 2 };
    } else throw new Error(`Unknown expression type: ${expr}`);
  }
}

export const assembler = new Assembler();
