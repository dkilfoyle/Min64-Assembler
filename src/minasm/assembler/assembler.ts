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
import { getDataSize, getExpressionSize } from "./utils";

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
  locations: Map<number, { offset?: number; length?: number }> = new Map();
  savedExpressions: { expr: Expression; pc: number; mc: number; isLSB: boolean }[] = [];

  reset() {
    this.mc = 0x2000;
    this.pc = 0x2000;
    this.isEmit = true;
    this.labels.clear();
    this.savedExpressions = [];
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

  assemble(ast: Program) {
    this.reset();

    // First pass: process directives and instructions to set up memory and program counter
    let i = 0;
    while (i < ast.entries.length) {
      const entry = ast.entries[i];
      if (isDirective(entry)) {
        this.processDirective(entry);
        i++;
      } else if (isInstruction(entry)) {
        i = this.processInstruction(ast, entry, i);
      } else if (isLabel(entry)) {
        this.processLabel(entry);
        i++;
      } else if (isData(entry)) {
        this.processData(entry);
        i++;
      } else i++;
    }

    this.hex.flush();

    (Array.from(this.labels).map(([lbl, addr]) => console.log(`0x${addr.toString(16).padStart(4, "0")} ${lbl}`)), this.hex.debug());

    // Second pass: recalculate address expressions and replace value in hex record
    for (const expr of this.savedExpressions) {
      this.mc = expr.mc;
      this.pc = expr.pc;
      const result = this.processExpression(expr.expr, expr.expr, expr.isLSB, SECOND_PASS);
      if (expr.isLSB) this.hex.replaceValue(this.mc, result.result & 0xff, 1);
      else this.hex.replaceValue(this.mc, result.result, result.size);
    }
  }

  processInstruction(ast: Program, instr: Instruction, i: number) {
    const info = instructionInfo[instr.op];
    this.emitByte(info.opcode);

    // this.locations.set(this.pc, { offset: instr.$cstNode?.offset, length: instr.$cstNode?.length });

    if (info.argType.length == 0) {
      return i + 1;
    } // 0 argument instruction

    // skip past any intervening labels or comments to the arguments (Data)
    while (!isData(ast.entries[++i])) {
      const nextEntry = ast.entries[i];
      if (isDirective(nextEntry)) throw Error(`Entry ${i}: Unexpected directive between instruction and it's arguments`);
      if (isLabel(nextEntry)) this.labels.set(nextEntry.name, this.pc);
    }

    // found the instruction arguments (Data) - consume them according to expected size
    const data = ast.entries[i] as Data;
    let dataIndex = 0;
    for (let argIndex = 0; argIndex < info.argType.length; argIndex++) {
      const expectedArgType = info.argType[argIndex];
      const expectedArgSize = info.argSize[argIndex];
      const isLSB = expectedArgType == 2 || expectedArgType == 4;
      const curDataItem = data.items[dataIndex++];
      const curDataResult = this.processExpression(curDataItem, curDataItem, isLSB, FIRST_PASS);

      if (expectedArgSize == 1) {
        if (isLSB) {
          // curDataResult should be an address of word size
          if (curDataResult.size != 2) throw Error("isLSB and didn't get word");
          this.emitByte(curDataResult.result & 0xff);
        } else {
          if (curDataResult.size != 1) throw Error("expecting byte but got word and not isLSB");
          this.emitByte(curDataResult.result);
        }
      } else if (expectedArgSize == 2) {
        if (curDataResult.size == 1) {
          const nextDataItem = data.items[dataIndex++];
          const nextDataResult = this.processExpression(nextDataItem, nextDataItem, isLSB, FIRST_PASS);
          if (nextDataResult.size !== 1) throw Error("expectedArgSize is 2 and should have received two consecutive bytes");
          this.emitByte(curDataResult.result);
          this.emitByte(nextDataResult.result);
        } else if (curDataResult.size == 2) {
          this.emitWord(curDataResult.result);
        } else throw Error("Unknown curDataResult.size");
      } else throw Error("invalid expected arg size");
    }

    if (dataIndex != data.items.length) throw Error(`Entry ${i}: More data items than expected arguments`);
    return i + 1;
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

  processData(data: Data): void {
    for (const item of data.items) {
      if (isStringLiteral(item) && item.value.length > 1) {
        // "....."
        item.value.split("").forEach((x) => this.emitByte(x.charCodeAt(0)));
      } else {
        const curDataResult = this.processExpression(item, item, FIRST_PASS);
        if (curDataResult.size == 1) this.emitByte(curDataResult.result);
        else if (curDataResult.size == 2) this.emitWord(curDataResult.result);
        else throw Error("Unknown data result size");
      }
    }
  }

  processLabel(label: Label) {
    this.labels.set(label.name, this.pc);
  }

  processExpression(expr: Expression, parentExpr: Expression, isLSB: boolean, pass: number): { result: number; size: number } {
    if (isBinaryExpression(expr)) {
      // Handle binary expressions (e.g., label + offset)
      const left = this.processExpression(expr.left, parentExpr, isLSB, pass);
      const right = this.processExpression(expr.right, parentExpr, isLSB, pass);
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
      let x = this.processExpression(expr.expr, parentExpr, isLSB, pass).result;
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
      if (pass == 1) {
        // label values have not been determined yet
        // return a dummy value 0xffff
        // save the parent expr, pc, mc so that it can be recalculated in pass 2
        this.savedExpressions.push({
          expr: parentExpr,
          pc: this.pc,
          mc: this.mc,
          isLSB,
        });
        return { result: 0xffff, size: 2 };
      } else {
        const labelName = expr.label.ref?.name;
        if (!labelName) throw new Error("Label reference has no name");
        const address = this.labels.get(labelName);
        if (address === undefined) throw new Error(`Undefined label: ${labelName}`);
        return { result: address, size: 2 };
      }
    } else if (isStarLiteral(expr)) {
      return { result: this.pc, size: 2 };
    } else throw new Error(`Unknown expression type: ${expr}`);
  }
}

export const assembler = new Assembler();
