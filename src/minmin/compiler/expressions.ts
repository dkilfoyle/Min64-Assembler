import {
  BinaryExpression,
  ComparisonExpression,
  FunctionCall,
  isBinaryExpression,
  isComparisonExpression,
  isFunctionCall,
  isNumberLiteral,
  isUnaryExpression,
  isVariableReference,
  NumberLiteral,
  UnaryExpression,
  VariableReference,
  type Expression,
} from "../ls/generated/ast";
import type { MinCompiler } from "./compiler";
import { hexByte, hexWord } from "./utils";

const runtime = import.meta.glob("./runtime/*.{asm}", {
  query: "?raw",
  import: "default",
  eager: true,
});

export class ExpressionCompiler {
  private zpBase: number;
  private runtimeUsed = new Set<string>();

  // computed zero-page addresses (word regs are 2 bytes: +0 = lsb, +1 = msb)
  readonly A: number;
  readonly B: number;
  readonly C: number;
  readonly D: number;
  readonly CNT: number;
  readonly FLAG: number;

  compiler: MinCompiler;

  constructor(minCompiler: MinCompiler) {
    this.compiler = minCompiler;
    this.zpBase = 0x00;

    this.A = this.zpBase + 0;
    this.B = this.zpBase + 2;
    this.C = this.zpBase + 4;
    this.D = this.zpBase + 6;
    this.CNT = this.zpBase + 8;
    this.FLAG = this.zpBase + 9;
  }

  reset() {
    this.runtimeUsed = new Set<string>();
  }

  out(instruction: string, comment?: string) {
    this.compiler.out(instruction, comment);
  }

  private pushWord(addr: number) {
    this.out(`LDZ ${hexByte(addr)} PHS LDZ ${hexByte(addr + 1)} PHS`, `push *(${hexByte(addr)})`);
  }
  private popWord(addr: number) {
    this.out(`PLS STZ ${hexByte(addr + 1)} PLS STZ ${hexByte(addr)}`, `pop to ${hexByte(addr)}`);
  }
  private pushZA() {
    this.out(`LDZ zA+0 PHS LDZ zA+1 PHS`, `push z_A`);
  }
  private popZA() {
    this.out(`PLS STZ zA+1 PLS STZ z_A+0`, `pop to z_A`);
  }

  /** Compile expr, leaving the 16-bit result in the z_A zero-page word. */
  compileExpression(e: Expression): void {
    switch (true) {
      case isNumberLiteral(e):
        return this.compileNum(e);
      case isVariableReference(e):
        return this.compileVar(e);
      case isFunctionCall(e):
        return this.compileCall(e);
      case isUnaryExpression(e):
        return this.compileUnary(e);
      case isComparisonExpression(e):
        return this.compileComparison(e);
      case isBinaryExpression(e):
        return this.compileBinary(e);
    }
  }

  private compileNum(e: NumberLiteral) {
    this.out(`MIV ${hexWord(e.value)},${hexByte(this.A)}`, `const ${e.value}`);
  }

  private compileVar(e: VariableReference) {
    const varName = e.varName.$refText;
    const v = this.compiler.getSymbolInfo(varName);
    if (!v) throw new Error(`Unknown variable '${varName}'`);
    if (v.kind != "variable") throw new Error(`Expected variable received function`);

    const isZP = (v.address & 0xff00) == 0;

    if (v.type === "int") {
      if (isZP) {
        this.out(`MVV ${hexByte(v.address)},z_A`, `${varName} (int, zp)`);
      } else {
        this.out(`MWV ${hexWord(v.address)},z_A)`, `${varName} (int, abs)`);
      }
      return;
    } else {
      // byte
      if (isZP) {
        this.out(`LDZ ${hexByte(v.address)}`, `${varName} (byte, zp)`);
      } else {
        this.out(`LDB ${hexWord(v.address)}`, `${varName} (byte, abs)`);
      }
      this.out("JPS __signext");
    }
  }

  private compileCall(e: FunctionCall) {
    const functionName = e.functionName.$refText;
    const f = this.compiler.getSymbolInfo(functionName);
    if (!f) throw new Error(`Unknown function '${functionName}'`);
    if (f.kind != "function") throw new Error(`Expected function received variable`);

    for (const arg of e.args) {
      this.compileExpression(arg); // result -> __A
      this.pushZA(); // push __A onto hw stack (lsb, msb)
    }

    this.out(`JPS ${functionName}`, `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`);
    if (e.args.length > 0) {
      this.out(`${"PLS ".repeat(e.args.length * 2).trim()}`, `discard ${e.args.length * 2} pushed arg byte(s)`);
    }
    // return value convention: callee leaves result in __A
  }

  private compileUnary(e: UnaryExpression) {
    this.compileExpression(e.inner);
    if (e.op === "-") {
      this.out(`NEV z_A`, `unary -`);
    } else {
      this.out(`NOV z_A`, `unary not (bitwise complement)`);
    }
  }

  private compileBinary(e: BinaryExpression) {
    const constSide = isNumberLiteral(e.left) ? e.left : isNumberLiteral(e.right) ? e.right : null;
    const otherSide = constSide === e.left ? e.right : e.left;

    if (constSide) {
      // constant operand optimisations
      if (e.op == "+") {
        this.compileExpression(otherSide);
        if (constSide.value == 1) {
          this.out(`INV z_A`, `++`);
          return;
        } else if ((constSide.value & 0xff00) == 0) {
          // anything + byte constant (or vice versa)
          this.out(`AIV ${constSide.value},z_A`, `+ byte constant`);
          return;
        } else {
          // anything + byte constant (or vice versa)
          this.out(`MIV ${constSide.value},z_B AVV z_B,z_A`, `+ word constant`);
          return;
        }
      }
      if (e.op == "-" && isNumberLiteral(e.right)) {
        if (e.right.value == 1) {
          this.out(`DEV z_A`, `--`);
        } else if ((e.right.value & 0xff00) == 0) {
          // anything - byte constant
          this.compileExpression(e.left);
          this.out(`SIV ${e.right.value},z_A`, `- byte constant`);
          return;
        }
      }
      if (e.op == "*") {
        // anything * power of 2 (or vice versa)
        const shift = Math.log2(constSide.value);
        if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
          this.compileExpression(otherSide);
          this.out(`MIV ${shift}, z_B JPS __shl16`);
          return;
        }
      }
    }

    // evaluate left, save; evaluate right into __A, move to __B; restore left into __A
    this.compileExpression(e.left);
    this.pushZA();

    this.compileExpression(e.right);
    this.out(`MVV z_A,z_B`);
    this.popZA();
    // now __A = left, __B = right

    switch (e.op) {
      case "+":
        this.out(`AVV $z_B,z_A`, `+`);
        break;
      case "-":
        this.out(`SVV z_B,z_A`, `-`);
        break;
      case "*":
        this.out(`JPS __mul16`, `*`);
        this.runtimeUsed.add("mul16");
        break;
      case "/":
        this.out(`JPS __div16`, `/ (divisor magnitude must fit in a byte)`);
        this.runtimeUsed.add("div16");
        break;
      case "and":
        this.out(`JPS __and16`, `and`);
        this.runtimeUsed.add("and16");
        break;
      case "or":
        this.out(`JPS __or16`, `or`);
        this.runtimeUsed.add("or16");
        break;
      case "xor":
        this.out(`JPS __xor16`, `xor`);
        this.runtimeUsed.add("xor16");
        break;
      case "<<":
        this.out(`JPS __shl16`, `<<`);
        this.runtimeUsed.add("shl16");
        break;
      case ">>":
        this.out(`JPS __shr16`, `>> (logical)`);
        this.runtimeUsed.add("shr16");
        break;
      default:
        throw new Error(`Unhandled binary operator '${e.op}'`);
    }
  }

  // Comparisons: ported from MIN's RelExpr. Left in __A, pushed; right computed into
  // __A then moved to __B; combine into __B via negate+add (or plain subtract for
  // <=/>=/>) and branch on sign to produce 0xffff/0x0000 in __A.
  private compileComparison(e: ComparisonExpression) {
    this.compileExpression(e.left);
    this.pushZA();

    this.compileExpression(e.right);
    this.out(`MVV z_A,z_B`);

    const trueLabel = this.compiler.nextLabel("cmp_true");
    const doneLabel = this.compiler.nextLabel("cmp_done");

    switch (e.op) {
      // PLS after each JPS to discard the
      case "<":
        this.out("JPS __lt16", "<");
        this.runtimeUsed.add("lt16");
        break;
      case ">":
        this.out("JPS __gt16", "<");
        this.runtimeUsed.add("gt16");
        break;
      case "==":
        this.out("JPS __eq16", "==");
        this.runtimeUsed.add("eq16");
        break;
      case "!=":
        this.out("JPS __neq16", "==");
        this.runtimeUsed.add("neq16");
        break;
      case "<=":
        this.out("JPS __lteq16", "==");
        this.runtimeUsed.add("lteq16");
        break;
      case ">=":
        this.out("JPS __gteq16", "==");
        this.runtimeUsed.add("gteq16");
        break;
      default:
        throw new Error(`Unhandled comparison operator '${e.op}'`);
    }

    this.out("PLS", "discard saved left expr off stack");
  }

  emitHeader() {
    this.out(`; ---- expression compiler zero-page working storage ----`);
    this.out(`#org ${hexWord(this.zpBase)}`);
    this.out(`z_A:      0x0000    ; accumulator / expression result / fn return value`);
    this.out(`z_B:      0x0000    ; secondary operand`);
    this.out(`z_C:      0x0000    ; scratch (mul/div/cmp)`);
    this.out(`z_D:      0x0000    ; scratch (div quotient)`);
    this.out(`z_cnt:    0x00      ; loop counter (mul/div/shifts)`);
    this.out(`z_flag:   0x00      ; sign flag (div)`);
    this.out(``);
  }

  emitRuntime() {
    this.out(`; --- runtime library ---`);
    this.out(`#page`);
    this.runtimeUsed.forEach((x) => {
      const code = runtime[x];
      if (!code) throw new Error(`Unable to find runtime code for ${x}`);
      code.split("\n").forEach((line) => this.out(line));
    });
  }
}
