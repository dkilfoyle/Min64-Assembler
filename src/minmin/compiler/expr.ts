/**
 * Expressionession AST -> Minimal-64x4 assembly compiler (slu4coder ISA).
 * Extended version: 16-bit ("word") arithmetic, comparisons, and
 * logical/shift operators, on top of the original 8-bit compiler.
 *
 * ============================== ASSUMPTIONS ==============================
 * The opcode table gives operand *types* (Z / V / addr / imm) but not the
 * exact addressing-mode encoding for multi-byte operands, and not literal
 * assembler punctuation. Two load-bearing assumptions are made here:
 *
 *   1. WORD LAYOUT: a "V" operand names the zero-page address of a word's
 *      LOW byte; the HIGH byte lives at addr+1 (little-endian, standard
 *      6502-descendant convention). Verify against the full manual.
 *
 *   2. COMPARISONS ARE UNSIGNED ONLY (per your call). All four ordering
 *      comparisons (< <= > >=) are built purely from the carry flag via
 *      BCC/BCS after a subtract-style compare (CPI/CPZ/CPB), which is
 *      unambiguously unsigned on 6502-style hardware: carry clear after
 *      A - operand means a borrow occurred, i.e. A < operand. `>` and `<=`
 *      are synthesized by swapping which side is subtracted from which
 *      (a > b  <=>  b < a), so BGT/BLE (whose signedness isn't documented
 *      in the excerpt I have) are never relied on.
 *
 *   3. MUL16 ABI: general 16-bit multiply has no opcode at all (same as
 *      8-bit), so it calls a runtime routine. Operands are written to
 *      opts.mul16OperandA / mul16OperandB (2 bytes each, MVV) and the
 *      product is assumed to come back as a word at opts.mul16Result.
 *      Adjust to match your actual MUL16 implementation's calling
 *      convention.
 * ===========================================================================
 *
 * Structural notes on 16-bit codegen:
 *  - Word add/sub are genuinely memory-to-memory in this ISA: AVV/SVV do
 *    `*dst = *dst +/- *src` in a single instruction. So word codegen
 *    doesn't route through a register at all; it tracks *which zero-page
 *    location currently holds the value* and mutates in place whenever
 *    that location is a disposable temp ("owned"), only copying
 *    (MVV) when the source is a live variable that must not be clobbered.
 *  - There is no word-level AND/OR/XOR, so those are synthesized as two
 *    independent byte AND/OR/XOR operations (low byte, high byte) routed
 *    through A (only byte bitwise ops exist).
 *  - There is no word-level right-shift instruction (only LLV exists for
 *    left). Right shift is synthesized as CLC + RRZ(hi) + RRZ(lo), which
 *    is the classic multi-byte rotate-through-carry technique. Left shift
 *    by 8+ or right shift by 8+ is special-cased to a byte move (MZZ) +
 *    clear (CLZ) instead of 8 repeated single-step shifts.
 *  - Comparisons (both widths) produce a 0/1 byte in A via a branch/set
 *    sequence, so they compose naturally with the bitwise operators
 *    (e.g. `(a < b) & (c > d)` is just two boolean bytes ANDed together).
 */

import {
  BinaryExpression,
  ComparisonExpression,
  isBinaryExpression,
  isComparisonExpression,
  isNumberLiteral,
  isUnaryExpression,
  isVariableReference,
  type Expression,
} from "../ls/generated/ast";
import type { MinCompiler, Width } from "./compiler";
import { hexByte, highOperand, immByte, immWord, lowOperand, type Addr } from "./utils";

type ArithOp = "+" | "-" | "&" | "|" | "^" | "<<" | ">>" | "*";
type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

interface Loc {
  addr: Addr;
  owned: boolean; // true = disposable temp we're free to mutate/free
}

function costByte(e: Expression): number {
  switch (true) {
    case isNumberLiteral(e):
    case isVariableReference(e):
      return 1;
    case isUnaryExpression(e):
      return 1 + costByte(e.expr);
    case isComparisonExpression(e):
      return costByte(e.left) + costByte(e.right) + 3;
    case isBinaryExpression(e):
      return costByte(e.left) + costByte(e.right) + 1;
    default:
      throw Error("costByte unknown expression type " + e.$type);
  }
}

/** Byte temps: stack-allocated downward, e.g. for CMP/shift-loop scratch. */
class ByteTemps {
  private next: number;
  private readonly floor: number;
  private inUse: number[] = [];
  constructor(start = 0x7e, floor = 0x5e) {
    this.next = start;
    this.floor = floor;
  }
  alloc(): number {
    if (this.next < this.floor) throw new Error("Byte temp pool exhausted");
    const a = this.next--;
    this.inUse.push(a);
    return a;
  }
  free(a: number): void {
    const top = this.inUse.pop();
    if (top !== a) throw new Error("Byte temp free/alloc order violated");
  }
}

/** Word temps: 2-byte-aligned pairs, separate range from byte temps so the two pools can never collide. */
class WordTemps {
  private next: number;
  private readonly floor: number;
  private inUse: number[] = [];
  constructor(start = 0x5d, floor = 0x3d) {
    this.next = start & ~1; // ensure even alignment
    this.floor = floor;
  }
  alloc(): number {
    if (this.next < this.floor) throw new Error("Word temp pool exhausted");
    const a = this.next;
    this.next -= 2;
    this.inUse.push(a);
    return a;
  }
  free(a: number): void {
    const top = this.inUse.pop();
    if (top !== a) throw new Error("Word temp free/alloc order violated");
  }
}

// ---------- Compile context ----------

// interface Ctx {
//   symbols: SymbolTable;
//   labels: LabelGen;
//   bytes: ByteTemps;
//   words: WordTemps;
//   mulRoutine: string;
//   mulOperandA: string;
//   mulOperandB: string;
//   mul16Routine: string;
//   mul16OperandA: string;
//   mul16OperandB: string;
//   mul16Result: string;
// }

// export interface CompileOptions {
//   symbols: SymbolTable;
//   mulRoutine?: string;
//   mulOperandA?: string;
//   mulOperandB?: string;
//   mul16Routine?: string;
//   mul16OperandA?: string;
//   mul16OperandB?: string;
//   mul16Result?: string;
// }

// ============================================================
// 8-BIT (byte) codegen -- result always ends up in A
// ============================================================

const IMM_MNEMONIC: Record<Exclude<ArithOp, "*" | "<<" | ">>">, string> = {
  "+": "ADI", // A = A + Imm
  "-": "SUI", // A = A - Imm
  "&": "ANI", // A = A & Imm
  "|": "ORI", // A = A | Imm
  "^": "XRI", // A = A ^ Imm
};

const Z_MNEMONIC: Record<Exclude<ArithOp, "*" | "<<" | ">>">, string> = {
  "+": "ADZ", // A = A + *Z
  "-": "SUZ", // A = A - *Z
  "&": "ANZ", // A = A & *Z
  "|": "ORZ", // A = A | *Z
  "^": "XRZ", // A = A ^ *Z
};

const COMMUTATIVE = new Set<string>(["+", "&", "|", "^"]); // a op b = b op a

export class ExpressionCompiler {
  compiler: MinCompiler;
  bytes = new ByteTemps();
  words = new WordTemps();

  constructor(minCompiler: MinCompiler) {
    this.compiler = minCompiler;
  }

  freeLoc(loc: Loc): void {
    if (loc.owned && typeof loc.addr === "number") this.words.free(loc.addr);
  }

  /** Guarantees the returned Loc is safe to mutate in place, copying into a  fresh temp first if the input was a live (non-owned) location. */
  ensureOwned(loc: Loc): number {
    if (loc.owned && typeof loc.addr === "number") return loc.addr;
    const t = this.words.alloc();
    this.compiler.emit(`MVV ${lowOperand(loc.addr)},${lowOperand(t)}`);
    return t;
  }

  widthOf(e: Expression): Width {
    switch (true) {
      case isNumberLiteral(e):
        return 8;
      case isVariableReference(e): {
        const entry = this.compiler.symbols.vars.get(e.varName.$refText);
        if (!entry) throw new Error(`Undefined variable '${e.varName.$refText}'`);
        return entry.width;
      }
      case isUnaryExpression(e):
        return this.widthOf(e.expr);
      case isComparisonExpression(e):
        return 8;
      case isBinaryExpression(e): {
        const lw = this.widthOf(e.left);
        if (e.op === "<<" || e.op === ">>") return lw; // because rw will always be 8
        const rw = this.widthOf(e.right);
        if (lw !== rw) {
          throw new Error(`Width mismatch in '${e.op}': left is ${lw}-bit, right is ${rw}-bit (no implicit widening)`);
        }
        return lw;
      }
      default:
        throw Error("Widthof unknown expression type " + e.$type);
    }
  }

  emitByteExpression(e: Expression): void {
    // A = evaluated e where e is an 8 bit result
    switch (true) {
      case isNumberLiteral(e):
        this.compiler.emit(`LDI ${immByte(e.value)}`);
        return;
      case isVariableReference(e): {
        const entry = this.compiler.symbols.vars.get(e.varName.$refText)!;
        this.compiler.emit(`LDZ ${lowOperand(entry.addr)} ; ${e.varName.$refText}`);
        return;
      }
      case isUnaryExpression(e):
        this.compiler.emit("; " + e.$cstNode?.text);
        if (e.op == "-") {
          this.emitByteExpression(e.expr);
          this.compiler.emit("NEG");
        } else if (e.op == "not") {
          this.emitByteExpression(e.expr);
          this.compiler.emit("NOT");
        } else throw Error("Uknown unary operation");
        return;
      case isComparisonExpression(e):
        this.emitByteCmp(e);
        return;
      case isBinaryExpression(e):
        this.emitByteBinop(e);
        return;
    }
  }

  emitByteBinop(e: BinaryExpression): void {
    const { op, left, right } = e;

    if (op === "*") {
      this.emitByteMultiply(left, right);
      return;
    }
    if (op === "<<" || op === ">>") {
      this.emitByteShift(op, left, right);
      return;
    }

    if (isNumberLiteral(right)) {
      if (!(op in IMM_MNEMONIC)) throw Error(`invalid op for binary expression left ${op} number`);
      this.emitByteExpression(left);
      this.compiler.emit(`${IMM_MNEMONIC[op as keyof typeof IMM_MNEMONIC]} ${immByte(right.value)}`); // eg ADI/SUI imm
      return;
    }

    if (isVariableReference(right)) {
      this.emitByteExpression(left);
      const entry = this.compiler.symbols.vars.get(right.varName.$refText)!;
      if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression left ${op} var`);
      this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${lowOperand(entry.addr)}`); // eg ADZ/SUZ var
      return;
    }

    // can do right first because order doesn't matter
    if (COMMUTATIVE.has(op)) {
      // num/var commutative_op right
      //
      if (isNumberLiteral(left)) {
        if (!(op in IMM_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
        this.emitByteExpression(right);
        this.compiler.emit(`${IMM_MNEMONIC[op as keyof typeof IMM_MNEMONIC]} ${immByte(left.value)}`);
        return;
      } else if (isVariableReference(left)) {
        if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
        this.emitByteExpression(right);
        const entry = this.compiler.symbols.vars.get(left.varName.$refText)!;
        this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${lowOperand(entry.addr)}`);
        return;
      } else {
        // order doesnt matter so do most expensive first so need fewer overall zp slots
        if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
        const [first, second] = costByte(left) >= costByte(right) ? [left, right] : [right, left];
        this.emitByteExpression(first);
        const t = this.bytes.alloc();
        this.compiler.emit(`STZ ${hexByte(t)}`);
        this.emitByteExpression(second);
        this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${hexByte(t)}`);
        this.bytes.free(t);
        return;
      }
    } else {
      // order does matter
      if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
      this.emitByteExpression(right);
      const t = this.bytes.alloc();
      this.compiler.emit(`STZ ${hexByte(t)}`);
      this.emitByteExpression(left);
      this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${hexByte(t)}`);
      this.bytes.free(t);
      return;
    }
  }

  emitByteShift(op: "<<" | ">>", left: Expression, right: Expression): void {
    const stepMnemonic = op === "<<" ? "LL" : "LR";

    if (isNumberLiteral(right)) {
      const k = right.value & 0xff;
      this.emitByteExpression(left);
      if (k === 0) return; // no-op
      if (k >= 8) {
        this.compiler.emit(`LDI ${immByte(0)}`); // shifted fully out
        return;
      }
      this.compiler.emit(`${stepMnemonic}${k}`); // single-instruction shift-by-k
      return;
    }

    // Runtime shift count: loop, shifting one step at a time.
    this.emitByteExpression(left);
    const work = this.bytes.alloc();
    this.compiler.emit(`STZ ${hexByte(work)}`);
    this.emitByteExpression(right);
    const count = this.bytes.alloc();
    this.compiler.emit(`STZ ${hexByte(count)}`);

    const loop = this.compiler.nextLabel("SHB");
    const done = this.compiler.nextLabel("SHBEND");
    this.compiler.emit(`${loop}:`);
    this.compiler.emit(`LDZ ${hexByte(count)}`);
    this.compiler.emit(`BEQ ${done}`);
    this.compiler.emit(`LDZ ${hexByte(work)}`);
    this.compiler.emit(`${stepMnemonic}1`);
    this.compiler.emit(`STZ ${hexByte(work)}`);
    this.compiler.emit(`DEZ ${hexByte(count)}`);
    this.compiler.emit(`JPA ${loop}`);
    this.compiler.emit(`${done}:`);
    this.compiler.emit(`LDZ ${hexByte(work)}`);

    this.bytes.free(count);
    this.bytes.free(work);
  }

  emitByteMultiply(left: Expression, right: Expression): void {
    const constSide = isNumberLiteral(left) ? left : isNumberLiteral(right) ? right : null;
    const otherSide = constSide === left ? right : left;

    if (constSide) {
      const k = constSide.value & 0xff;
      if (k === 0) {
        // anything * 0 = 0
        this.compiler.emit(`LDI ${immByte(0)}`);
        return;
      }
      if (k === 1) {
        // anything * 1 = anything
        this.emitByteExpression(otherSide);
        return;
      }
      const shift = Math.log2(k);
      if (Number.isInteger(shift) && shift >= 1 && shift <= 7) {
        // multiplying anything by 2,4,8,16,32,64,128 same as LL1-7
        this.emitByteExpression(otherSide);
        this.compiler.emit(`LL${shift}`);
        return;
      }
    }

    if (isNumberLiteral(right) || isVariableReference(right)) {
      this.emitByteExpression(left);
      this.compiler.emit(`STZ mulOperandA`);
      this.emitByteExpression(right);
      this.compiler.emit(`STZ mulOperandB`);
    } else {
      this.emitByteExpression(right);
      const t = this.bytes.alloc();
      this.compiler.emit(`STZ ${hexByte(t)}`); // temp = right
      this.emitByteExpression(left);
      this.compiler.emit(`STZ mulOperandA`);
      this.compiler.emit(`LDZ ${hexByte(t)}`);
      this.compiler.emit(`STZ mulOperandB`);
      this.bytes.free(t);
    }
    this.compiler.emit(`JPS mulRoutine`);
  }

  /** a OP b (unsigned, byte width) -> 0/1 in A, via CPx + BCC/BCS/BEQ/BNE. */
  emitByteCmp(e: ComparisonExpression): void {
    let { op, left, right } = e;

    // a > b  <=>  b < a ; a <= b <=> b >= a. Swap so only 4 primitive
    // conditions (== != < >=) are ever actually emitted.
    if (op === ">") {
      [left, right] = [right, left];
      op = "<";
    } else if (op === "<=") {
      [left, right] = [right, left];
      op = ">=";
    }

    // Evaluate into A (left) and a CPx-comparable right operand, reusing the
    // same leaf-fold-vs-spill strategy as arithmetic ops.
    if (isNumberLiteral(right)) {
      this.emitByteExpression(left);
      this.compiler.emit(`CPI ${immByte(right.value)}`);
    } else if (isVariableReference(right)) {
      this.emitByteExpression(left);
      const entry = this.compiler.symbols.vars.get(right.varName.$refText)!;
      this.compiler.emit(`CPZ ${lowOperand(entry.addr)}`);
    } else {
      this.emitByteExpression(right);
      const t = this.bytes.alloc();
      this.compiler.emit(`STZ ${hexByte(t)}`);
      this.emitByteExpression(left);
      this.compiler.emit(`CPZ ${hexByte(t)}`);
      this.bytes.free(t);
    }

    const branch = op === "==" ? "BEQ" : op === "!=" ? "BNE" : op === "<" ? "BCC" : "BCS"; // >=

    const trueLabel = this.compiler.nextLabel("CT");
    const endLabel = this.compiler.nextLabel("CE");
    this.compiler.emit(`${branch} ${trueLabel}`);
    this.compiler.emit(`LDI ${immByte(0)}`);
    this.compiler.emit(`JPA ${endLabel}`);
    this.compiler.emit(`${trueLabel}:`);
    this.compiler.emit(`LDI ${immByte(1)}`);
    this.compiler.emit(`${endLabel}:`);
  }

  emitWordExpression(e: Expression): Loc {
    switch (true) {
      case isNumberLiteral(e): {
        const t = this.words.alloc();
        this.compiler.emit(`MIV ${immWord(e.value)},${lowOperand(t)}`);
        return { addr: t, owned: true };
      }
      case isVariableReference(e): {
        const entry = this.compiler.symbols.vars.get(e.varName.$refText)!;
        return { addr: entry.addr, owned: false };
      }
      case isUnaryExpression(e): {
        const L = this.emitWordExpression(e.expr);
        const dst = this.ensureOwned(L);
        if (e.op == "-") this.compiler.emit(`NEV ${lowOperand(dst)}`);
        else this.compiler.emit(`NOV ${lowOperand(dst)}`);
        return { addr: dst, owned: true };
      }
      case isComparisonExpression(e):
        throw Error("cmp cannot appear as a 16-bit-width operand; it always yields a byte");
      case isBinaryExpression(e):
        return this.emitWordBinop(e);
      default:
        throw Error("emitWord unknown expression type " + e.$type);
    }
  }

  emitWordBinop(e: BinaryExpression): Loc {
    const { op, left, right } = e;

    if (op === "*") return this.emitWordMultiply(left, right);
    if (op === "<<" || op === ">>") return this.emitWordShift(op, left, right);

    // Optimization: adding/subtracting a compile-time constant that fits in
    // a byte can use AIV/SIV directly (single instruction, carry-propagated)
    // instead of materializing a full word constant via MIV + AVV/SVV. Check
    // this BEFORE evaluating the right side at all, so the constant is never
    // needlessly loaded into a word temp in the first place.
    if ((op === "+" || op === "-") && isNumberLiteral(right) && (right.value & 0xff00) === 0) {
      const Lloc = this.emitWordExpression(left);
      const dst = this.ensureOwned(Lloc);
      this.compiler.emit(`${op === "+" ? "AIV" : "SIV"} ${immByte(right.value)},${lowOperand(dst)}`);
      return { addr: dst, owned: true };
    }

    const Lloc = this.emitWordExpression(left);
    const Rloc = this.emitWordExpression(right);

    if (op === "+" || op === "-") {
      // AVV/SVV are memory-to-memory: dst OP= src, single instruction.
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
      this.compiler.emit(`${op === "+" ? "AVV" : "SVV"} ${lowOperand(src)},${lowOperand(dst)}`);
      if (dst !== Lloc.addr) this.freeLoc(Lloc);
      if (typeof src !== "number" || src !== Rloc.addr || dst === Rloc.addr) {
        // src side no longer needed unless it *is* the returned dst
      }
      if (dst !== Rloc.addr) this.freeLoc(Rloc);
      return { addr: dst, owned: true };
    }

    // &, |, ^ : no word opcode exists -> two independent byte ops through A.
    const dst = Lloc.owned ? (Lloc.addr as number) : this.ensureOwned(Lloc);
    const byteMnemonic = op === "and" ? "ANZ" : op === "or" ? "ORZ" : "XRZ";
    this.compiler.emit(`LDZ ${lowOperand(dst)}`);
    this.compiler.emit(`${byteMnemonic} ${lowOperand(Rloc.addr)}`);
    this.compiler.emit(`STZ ${lowOperand(dst)}`);
    this.compiler.emit(`LDZ ${highOperand(dst)}`);
    this.compiler.emit(`${byteMnemonic} ${highOperand(Rloc.addr)}`);
    this.compiler.emit(`STZ ${highOperand(dst)}`);
    if (dst !== Lloc.addr) this.freeLoc(Lloc);
    this.freeLoc(Rloc);
    return { addr: dst, owned: true };
  }

  shiftWordConstLeft(dst: number, k: number): void {
    if (k <= 0) return;
    if (k >= 16) {
      this.compiler.emit(`MIV ${immWord(0)},${hexByte(dst)}`);
      return;
    }
    if (k >= 8) {
      this.compiler.emit(`MZZ ${hexByte(dst)},${hexByte(dst + 1)}`); // hi = lo
      this.compiler.emit(`CLZ ${hexByte(dst)}`); // lo = 0
      k -= 8;
    }
    for (let i = 0; i < k; i++) this.compiler.emit(`LLV ${hexByte(dst)}`);
  }

  shiftWordConstRight(dst: number, k: number): void {
    if (k <= 0) return;
    if (k >= 16) {
      this.compiler.emit(`MIV ${immWord(0)},${hexByte(dst)}`);
      return;
    }
    if (k >= 8) {
      this.compiler.emit(`MZZ ${hexByte(dst + 1)},${hexByte(dst)}`); // lo = hi
      this.compiler.emit(`CLZ ${hexByte(dst + 1)}`); // hi = 0
      k -= 8;
    }
    for (let i = 0; i < k; i++) {
      this.compiler.emit("CLC");
      this.compiler.emit(`RRZ ${hexByte(dst + 1)}`); // hi rotates right through carry
      this.compiler.emit(`RRZ ${hexByte(dst)}`); // then lo, picking up carry from hi
    }
  }

  emitWordShift(op: "<<" | ">>", left: Expression, right: Expression): Loc {
    const Lloc = this.emitWordExpression(left);
    const dst = this.ensureOwned(Lloc);

    if (isNumberLiteral(right)) {
      const k = right.value & 0xff;
      if (op === "<<") this.shiftWordConstLeft(dst, k);
      else this.shiftWordConstRight(dst, k);
      return { addr: dst, owned: true };
    }

    // Runtime shift count.
    this.emitByteExpression(right);
    const count = this.bytes.alloc();
    this.compiler.emit(`STZ ${hexByte(count)}`);
    const loop = this.compiler.nextLabel("SHW");
    const done = this.compiler.nextLabel("SHWEND");
    this.compiler.emit(`${loop}:`);
    this.compiler.emit(`LDZ ${hexByte(count)}`);
    this.compiler.emit(`BEQ ${done}`);
    if (op === "<<") {
      this.compiler.emit(`LLV ${hexByte(dst)}`);
    } else {
      this.compiler.emit("CLC");
      this.compiler.emit(`RRZ ${hexByte(dst + 1)}`);
      this.compiler.emit(`RRZ ${hexByte(dst)}`);
    }
    this.compiler.emit(`DEZ ${hexByte(count)}`);
    this.compiler.emit(`JPA ${loop}`);
    this.compiler.emit(`${done}:`);
    this.bytes.free(count);
    return { addr: dst, owned: true };
  }

  emitWordMultiply(left: Expression, right: Expression): Loc {
    const constSide = isNumberLiteral(left) ? left : isNumberLiteral(right) ? right : null;
    const otherSide = constSide === left ? right : left;

    if (constSide) {
      const k = constSide.value & 0xffff;
      if (k === 0) {
        const t = this.words.alloc();
        this.compiler.emit(`MIV ${immWord(0)},${lowOperand(t)}`);
        return { addr: t, owned: true };
      }
      if (k === 1) {
        return this.emitWordExpression(otherSide);
      }
      const shift = Math.log2(k);
      if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
        const L = this.emitWordExpression(otherSide);
        const dst = this.ensureOwned(L);
        this.shiftWordConstLeft(dst, shift);
        return { addr: dst, owned: true };
      }
    }

    // General 16x16 multiply: no opcode exists -> runtime MUL16 call.
    const Lloc = this.emitWordExpression(left);
    this.compiler.emit(`MVV ${lowOperand(Lloc.addr)}, mul16OperandA`);
    this.freeLoc(Lloc);
    const Rloc = this.emitWordExpression(right);
    this.compiler.emit(`MVV ${lowOperand(Rloc.addr)}, this.mul16OperandB`);
    this.freeLoc(Rloc);
    this.compiler.emit(`JPS mul16Routine`);
    return { addr: "mul16Result", owned: true };
  }

  /** a OP b (unsigned, word width) -> 0/1 in A. */
  emitWordCmp(e: ComparisonExpression): void {
    this.compiler.emit("; " + e.$cstNode?.text);
    let { op, left, right } = e;
    if (op === ">") {
      [left, right] = [right, left];
      op = "<";
    } else if (op === "<=") {
      [left, right] = [right, left];
      op = ">=";
    }

    const Lloc = this.emitWordExpression(left);
    const Rloc = this.emitWordExpression(right);

    if (op === "==" || op === "!=") {
      const notEqual = this.compiler.nextLabel("WNE");
      const end = this.compiler.nextLabel("WEQE");
      this.compiler.emit(`LDZ ${lowOperand(Lloc.addr)}`);
      this.compiler.emit(`CPZ ${lowOperand(Rloc.addr)}`);
      this.compiler.emit(`BNE ${notEqual}`);
      this.compiler.emit(`LDZ ${highOperand(Lloc.addr)}`);
      this.compiler.emit(`CPZ ${highOperand(Rloc.addr)}`);
      this.compiler.emit(`BNE ${notEqual}`);
      if (op === "==") {
        this.compiler.emit(`LDI ${immByte(1)}`);
        this.compiler.emit(`JPA ${end}`);
        this.compiler.emit(`${notEqual}:`);
        this.compiler.emit(`LDI ${immByte(0)}`);
      } else {
        this.compiler.emit(`LDI ${immByte(0)}`);
        this.compiler.emit(`JPA ${end}`);
        this.compiler.emit(`${notEqual}:`);
        this.compiler.emit(`LDI ${immByte(1)}`);
      }
      this.compiler.emit(`${end}:`);
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

    this.compiler.emit(`LDZ ${highOperand(Lloc.addr)}`);
    this.compiler.emit(`CPZ ${highOperand(Rloc.addr)}`);
    this.compiler.emit(`BNE ${hiDiffers}`);
    this.compiler.emit(`LDZ ${lowOperand(Lloc.addr)}`);
    this.compiler.emit(`CPZ ${lowOperand(Rloc.addr)}`);
    this.compiler.emit(`${branch} ${trueL}`);
    this.compiler.emit(`JPA ${falseL}`);
    this.compiler.emit(`${hiDiffers}:`);
    this.compiler.emit(`${branch} ${trueL}`);
    this.compiler.emit(`JPA ${falseL}`);
    this.compiler.emit(`${trueL}:`);
    this.compiler.emit(`LDI ${immByte(1)}`);
    this.compiler.emit(`JPA ${end}`);
    this.compiler.emit(`${falseL}:`);
    this.compiler.emit(`LDI ${immByte(0)}`);
    this.compiler.emit(`${end}:`);

    this.freeLoc(Lloc);
    this.freeLoc(Rloc);
  }

  compileExpression(e: Expression) {
    if (isComparisonExpression(e)) {
      const w = this.widthOf(e.left);
      if (w === 8) this.emitByteCmp(e);
      else this.emitWordCmp(e);
      return { width: "byte" };
    }

    const w = this.widthOf(e);
    if (w === 8) {
      this.emitByteExpression(e);
      return "byte";
    } else {
      const loc = this.emitWordExpression(e);
      return { width: "word", resultAddr: loc.addr };
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
