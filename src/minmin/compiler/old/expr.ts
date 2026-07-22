import {
  AdditionExpression,
  ComparisonExpression,
  isAdditionExpression,
  isComparisonExpression,
  isLogicExpression,
  isMultiplicationExpression,
  isNumberLiteral,
  isUnaryExpression,
  isVariableReference,
  LogicExpression,
  type Expression,
} from "../../ls/generated/ast";
import type { MinCompiler, Width } from "../compiler";
import { hexByte, hexWord, highOperand, immByte, immWord, lowOperand, type Addr } from "../utils";

export class ExpressionCompiler {
  compiler: MinCompiler;

  constructor(minCompiler: MinCompiler) {
    this.compiler = minCompiler;
  }

  out(instruction: string, comment?: string) {
    this.compiler.out(instruction, comment);
  }

  emitExpression(e: Expression): Loc {
    switch (true) {
      case isLogicExpression(e):
        return this.emitLogic(e);
      case isComparisonExpression(e):
        return this.emitComparison(e);
      case isAdditionExpression(e):
        return this.emitAddition(e);
      case isMultiplicationExpression(e):
        return this.emitMultiplication(e);
      case isUnaryExpression(e): {
        const L = this.emitExpression(e.value);
        const dst = this.ensureOwned(L);
        if (e.op == "-") this.compiler.out(`NEV ${lowOperand(dst)}`);
        else this.compiler.out(`NOV ${lowOperand(dst)}`);
        return { addr: dst, owned: true };
      }
      case isNumberLiteral(e): {
        const t = this.words.alloc();
        this.compiler.out(`MIV ${immWord(e.value)},${lowOperand(t)}`);
        return { addr: t, owned: true };
      }
      case isVariableReference(e): {
        const entry = this.compiler.symbols.vars.get(e.varName.$refText)!;
        if (entry.width == 8) {
          // convert byte to word temp, need to sign extend
          const t = this.words.alloc();
          this.compiler.out(`MBZ ${e.varName.$refText} z_ptrA} LL1 FCS`);

          this.compiler.out("JPS getVar");
          return { addr: t, owned: true };
        } else {
          // width == word
          if (entry.addr > 0xff) {
            // copy word at abs addr to zp temp
            const t = this.words.alloc();
            this.compiler.out(`MWV ${e.varName.$refText} ${lowOperand(t)}`);
            return { addr: t, owned: true };
          }
          return { addr: entry.addr, owned: false };
        }
      }
      default:
        throw Error("emit unknown expression type " + e.$type);
    }
  }

  emitLogic(e: LogicExpression): Loc {
    const { op, left, right } = e;
    if (op === "<<" || op === ">>") return this.emitShift(op, left, right);

    const Lloc = this.emitExpression(left);
    const Rloc = this.emitExpression(right);

    // &, |, ^ : no word opcode exists -> two independent byte ops through A.
    const dst = Lloc.owned ? (Lloc.addr as number) : this.ensureOwned(Lloc);
    const byteMnemonic = op === "and" ? "ANZ" : op === "or" ? "ORZ" : "XRZ";
    this.compiler.out(`LDZ ${lowOperand(dst)}`);
    this.compiler.out(`${byteMnemonic} ${lowOperand(Rloc.addr)}`);
    this.compiler.out(`STZ ${lowOperand(dst)}`);
    this.compiler.out(`LDZ ${highOperand(dst)}`);
    this.compiler.out(`${byteMnemonic} ${highOperand(Rloc.addr)}`);
    this.compiler.out(`STZ ${highOperand(dst)}`);
    if (dst !== Lloc.addr) this.freeLoc(Lloc);
    this.freeLoc(Rloc);
    return { addr: dst, owned: true };
  }

  emitAddition(e: AdditionExpression): Loc {
    const { op, left, right } = e;
    // Optimization: adding/subtracting a compile-time constant that fits in
    // a byte can use AIV/SIV directly (single instruction, carry-propagated)
    // instead of materializing a full word constant via MIV + AVV/SVV. Check
    // this BEFORE evaluating the right side at all, so the constant is never
    // needlessly loaded into a word temp in the first place.
    if ((op === "+" || op === "-") && isNumberLiteral(right) && (right.value & 0xff00) === 0) {
      const Lloc = this.emitExpression(left);
      const dst = this.ensureOwned(Lloc);
      this.compiler.out(`${op === "+" ? "AIV" : "SIV"} ${immByte(right.value)},${lowOperand(dst)}`);
      return { addr: dst, owned: true };
    }

    const Lloc = this.emitExpression(left);
    const Rloc = this.emitExpression(right);

    // find or create an operand that is an owned temp and can be overwritten by +=/-= operation
    let dst: number, src: Addr;
    if (Lloc.owned) {
      dst = Lloc.addr as number;
      src = Rloc.addr;
    } else if (op === "+" && Rloc.owned) {
      // commutative: reuse the right side as destination instead
      dst = Rloc.addr as number;
      src = Lloc.addr;
    } else {
      dst = this.ensureOwned(Lloc);
      src = Rloc.addr;
    }

    // dst += src or dst -= src
    this.compiler.out(`${op === "+" ? "AVV" : "SVV"} ${lowOperand(src)},${lowOperand(dst)}`);

    if (dst !== Lloc.addr) this.freeLoc(Lloc);
    if (typeof src !== "number" || src !== Rloc.addr || dst === Rloc.addr) {
      // src side no longer needed unless it *is* the returned dst
    }
    if (dst !== Rloc.addr) this.freeLoc(Rloc);
    return { addr: dst, owned: true };
  }

  shiftWordConstLeft(dst: number, k: number): void {
    if (k <= 0) return;
    if (k >= 16) {
      this.compiler.out(`MIV ${immWord(0)},${hexByte(dst)}`);
      return;
    }
    if (k >= 8) {
      this.compiler.out(`MZZ ${hexByte(dst)},${hexByte(dst + 1)}`); // hi = lo
      this.compiler.out(`CLZ ${hexByte(dst)}`); // lo = 0
      k -= 8;
    }
    for (let i = 0; i < k; i++) this.compiler.out(`LLV ${hexByte(dst)}`);
  }

  shiftWordConstRight(dst: number, k: number): void {
    if (k <= 0) return;
    if (k >= 16) {
      this.compiler.out(`MIV ${immWord(0)},${hexByte(dst)}`);
      return;
    }
    if (k >= 8) {
      this.compiler.out(`MZZ ${hexByte(dst + 1)},${hexByte(dst)}`); // lo = hi
      this.compiler.out(`CLZ ${hexByte(dst + 1)}`); // hi = 0
      k -= 8;
    }
    for (let i = 0; i < k; i++) {
      this.compiler.out("CLC");
      this.compiler.out(`RRZ ${hexByte(dst + 1)}`); // hi rotates right through carry
      this.compiler.out(`RRZ ${hexByte(dst)}`); // then lo, picking up carry from hi
    }
  }

  emitShift(op: "<<" | ">>", left: Expression, right: Expression): Loc {
    const Lloc = this.emitExpression(left);
    const dst = this.ensureOwned(Lloc);

    if (isNumberLiteral(right)) {
      const k = right.value & 0xff;
      if (op === "<<") this.shiftWordConstLeft(dst, k);
      else this.shiftWordConstRight(dst, k);
      return { addr: dst, owned: true };
    }

    // Runtime shift count.
    this.emitExpression(right);
    const count = this.bytes.alloc();
    this.compiler.out(`STZ ${hexByte(count)}`);
    const loop = this.compiler.nextLabel("SHW");
    const done = this.compiler.nextLabel("SHWEND");
    this.compiler.out(`${loop}:`);
    this.compiler.out(`LDZ ${hexByte(count)}`);
    this.compiler.out(`BEQ ${done}`);
    if (op === "<<") {
      this.compiler.out(`LLV ${hexByte(dst)}`);
    } else {
      this.compiler.out("CLC");
      this.compiler.out(`RRZ ${hexByte(dst + 1)}`);
      this.compiler.out(`RRZ ${hexByte(dst)}`);
    }
    this.compiler.out(`DEZ ${hexByte(count)}`);
    this.compiler.out(`JPA ${loop}`);
    this.compiler.out(`${done}:`);
    this.bytes.free(count);
    return { addr: dst, owned: true };
  }

  emitMultiply(left: Expression, right: Expression): Loc {
    const constSide = isNumberLiteral(left) ? left : isNumberLiteral(right) ? right : null;
    const otherSide = constSide === left ? right : left;

    if (constSide) {
      const k = constSide.value & 0xffff;
      if (k === 0) {
        const t = this.words.alloc();
        this.compiler.out(`MIV ${immWord(0)},${lowOperand(t)}`);
        return { addr: t, owned: true };
      }
      if (k === 1) {
        return this.emitExpression(otherSide);
      }
      const shift = Math.log2(k);
      if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
        const L = this.emitExpression(otherSide);
        const dst = this.ensureOwned(L);
        this.shiftWordConstLeft(dst, shift);
        return { addr: dst, owned: true };
      }
    }

    // General 16x16 multiply: no opcode exists -> runtime MUL16 call.
    const Lloc = this.emitExpression(left);
    this.compiler.out(`MVV ${lowOperand(Lloc.addr)}, mul16OperandA`);
    this.freeLoc(Lloc);
    const Rloc = this.emitExpression(right);
    this.compiler.out(`MVV ${lowOperand(Rloc.addr)}, this.mul16OperandB`);
    this.freeLoc(Rloc);
    this.compiler.out(`JPS mul16Routine`);
    return { addr: "mul16Result", owned: true };
  }

  /** a OP b (unsigned, word width) -> 0/1 in A. */
  emitCmp(e: ComparisonExpression): void {
    this.compiler.out("; " + e.$cstNode?.text);
    let { op, left, right } = e;
    if (op === ">") {
      [left, right] = [right, left];
      op = "<";
    } else if (op === "<=") {
      [left, right] = [right, left];
      op = ">=";
    }

    const Lloc = this.emitExpression(left);
    const Rloc = this.emitExpression(right);

    if (op === "==" || op === "!=") {
      const notEqual = this.compiler.nextLabel("WNE");
      const end = this.compiler.nextLabel("WEQE");
      this.compiler.out(`LDZ ${lowOperand(Lloc.addr)}`);
      this.compiler.out(`CPZ ${lowOperand(Rloc.addr)}`);
      this.compiler.out(`BNE ${notEqual}`);
      this.compiler.out(`LDZ ${highOperand(Lloc.addr)}`);
      this.compiler.out(`CPZ ${highOperand(Rloc.addr)}`);
      this.compiler.out(`BNE ${notEqual}`);
      if (op === "==") {
        this.compiler.out(`LDI ${immByte(1)}`);
        this.compiler.out(`JPA ${end}`);
        this.compiler.out(`${notEqual}:`);
        this.compiler.out(`LDI ${immByte(0)}`);
      } else {
        this.compiler.out(`LDI ${immByte(0)}`);
        this.compiler.out(`JPA ${end}`);
        this.compiler.out(`${notEqual}:`);
        this.compiler.out(`LDI ${immByte(1)}`);
      }
      this.compiler.out(`${end}:`);
      this.freeLoc(Lloc);
      this.freeLoc(Rloc);
      return;
    }

    // Ordering (< or >=): compare high bytes first; if they differ, that
    // comparison alone decides it. If equal, fall through to the low bytes.
    const branch = op === "<" ? "BCC" : "BCS";
    const hiDiffers = this.compiler.nextLabel("WHID");
    const trueL = this.compiler.nextLabel("WT");
    const falseL = this.compiler.nextLabel("WF");
    const end = this.compiler.nextLabel("WORDE");

    this.compiler.out(`LDZ ${highOperand(Lloc.addr)}`);
    this.compiler.out(`CPZ ${highOperand(Rloc.addr)}`);
    this.compiler.out(`BNE ${hiDiffers}`);
    this.compiler.out(`LDZ ${lowOperand(Lloc.addr)}`);
    this.compiler.out(`CPZ ${lowOperand(Rloc.addr)}`);
    this.compiler.out(`${branch} ${trueL}`);
    this.compiler.out(`JPA ${falseL}`);
    this.compiler.out(`${hiDiffers}:`);
    this.compiler.out(`${branch} ${trueL}`);
    this.compiler.out(`JPA ${falseL}`);
    this.compiler.out(`${trueL}:`);
    this.compiler.out(`LDI ${immByte(1)}`);
    this.compiler.out(`JPA ${end}`);
    this.compiler.out(`${falseL}:`);
    this.compiler.out(`LDI ${immByte(0)}`);
    this.compiler.out(`${end}:`);

    this.freeLoc(Lloc);
    this.freeLoc(Rloc);
  }

  compileExpression(e: Expression): ExpressionResult {
    if (isComparisonExpression(e)) {
      const w = this.widthOf(e.left);
      if (w === 8) {
        this.compiler.out("; byte expression: " + e.$cstNode?.text);
        this.emitByteCmp(e);
      } else {
        this.compiler.out("; word expression: " + e.$cstNode?.text);
        this.emitCmp(e);
      }
      return { width: "byte" };
    }

    const w = this.widthOf(e);
    if (w === 8) {
      this.compiler.out("; byte expression: " + e.$cstNode?.text);
      this.emitByteExpression(e);
      return { width: "byte" };
    } else {
      this.compiler.out("; word expression: " + e.$cstNode?.text);
      const loc = this.emitExpression(e);
      return { width: "word", loc };
    }
  }
}

// ---------- Demo ----------

// function demo() {
//   const symbols: SymbolTable = {
//     vars: new Map<string, SymbolEntry>([
//       ["a", { addr: 0x00, width: 8 }],
//       ["b", { addr: 0x01, width: 8 }],
//       ["x", { addr: 0x10, width: 16 }], // occupies 0x10 (lo) / 0x11 (hi)
//       ["y", { addr: 0x12, width: 16 }],
//     ]),
//   };
//   const opts: CompileOptions = { symbols };

//   console.log("== x + y (16-bit add) ==");
//   console.log("\n== x + 5 (16-bit add, byte-immediate optimization) ==");
//   console.log("\n== x & y (no word AND opcode -> byte-pair synthesis) ==");
//   console.log("\n== x << 3 ==");
//   console.log("\n== x >> 10 (uses the shift-by-8 shortcut + 2 single steps) ==");
//   console.log("\n== a < b (8-bit unsigned compare) ==");
//   console.log("\n== x >= y (16-bit unsigned compare) ==");
//   console.log("\n== (a < b) & (x != y)  -- comparisons composed with a logical op ==");
// }

// demo();
