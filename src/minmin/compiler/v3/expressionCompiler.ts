import {
  BinaryExpression,
  ComparisonExpression,
  FunctionCall,
  isBinaryExpression,
  isFunctionCall,
  isNumberLiteral,
  isUnaryExpression,
  isVariableReference,
  NumberLiteral,
  UnaryExpression,
  VariableReference,
  type Expression,
} from "../../ls/generated/ast";
import type { MinCompiler } from "./compiler";
import { CompileError, hexByte, hexWord } from "../utils";
import type { AstNode } from "langium";

const runtimeGlob = import.meta.glob("../runtime/*.asm", {
  query: "?raw",
  import: "default",
  eager: true,
});

const runtime = Object.fromEntries(
  Object.entries(runtimeGlob).map(([path, definition]) => {
    // Extract file name without extension to use as the new key
    const fileName =
      "__" + path.slice(path.lastIndexOf("/") + 1).replace(".asm", "");
    return [fileName, definition];
  }),
);

const VIRTUAL_STACK_BASE = 0xefff;
const ZP_BASE = 0x00;

export class ExpressionCompiler {
  compiler: MinCompiler;

  constructor(minCompiler: MinCompiler) {
    this.compiler = minCompiler;
  }

  reset() {}

  out(instruction: string, comment?: string) {
    this.compiler.out(instruction, comment);
  }
  outi(instruction: string, comment?: string) {
    this.compiler.outi(instruction, comment);
  }

  private emitHWPushZA() {
    this.outi(`LDZ z_A+0 PHS LDZ z_A+1 PHS`, `push z_A onto hardware stack`);
  }

  private emitHWPopZA() {
    this.outi(`PLS SDZ z_A+1 PLS SDZ z_A+0`, `pop z_A from hardware stack`);
  }

  /** Compile expr, leaving the 16-bit result in the z_A zero-page word. */
  compileExpression(e: Expression): void {
    switch (true) {
      case isNumberLiteral(e):
        return this.compileNum(e);
      case isVariableReference(e):
        return this.compileVar(e);
      case isFunctionCall(e):
        return this.compiler.compileFunctionCall(e);
      case isUnaryExpression(e):
        return this.compileUnary(e);
      case isBinaryExpression(e):
        return this.compileBinary(e);
    }
  }

  private compileNum(e: NumberLiteral) {
    const valueStr = `const ${e.value}`;
    if (this.compiler.cached.z_A == valueStr) return;
    this.outi(`MIV ${hexWord(e.value)},z_A`, valueStr);
    this.compiler.cached.z_A = valueStr;
  }

  private compileVar(e: VariableReference) {
    const varName = e.varName.$refText;
    const v = this.compiler.getSymbol(varName, e);

    if (v.location != "stack")
      throw new CompileError(`Non stack variables not supported yet`, e);

    this.compiler.emitCopyVarIntoZ(varName, "z_A");
  }

  compileUnary(e: UnaryExpression) {
    this.compileExpression(e.inner);
    if (e.op === "-") {
      this.outi(`NEV z_A`, `unary -`);
    } else {
      this.outi(`NOV z_A`, `unary not (bitwise complement)`);
    }
  }

  compileBinary(e: BinaryExpression) {
    const constSide = isNumberLiteral(e.left)
      ? e.left
      : isNumberLiteral(e.right)
        ? e.right
        : null;
    const otherSide = constSide === e.left ? e.right : e.left;

    if (constSide) {
      // constant operand optimisations
      if (e.op == "+") {
        this.compileExpression(otherSide);
        if (constSide.value == 1) {
          this.outi(`INV z_A`, `++`);
        } else if ((constSide.value & 0xff00) == 0) {
          // anything + byte constant (or vice versa)
          this.outi(`AIV ${constSide.value},z_A`, `+ byte constant`);
        } else {
          // anything + byte constant (or vice versa)
          this.outi(
            `MIV ${constSide.value},z_B AVV z_B,z_A`,
            `+ word constant`,
          );
        }
        this.compiler.cached.z_A = "";
        return;
      }
      if (e.op == "-" && isNumberLiteral(e.right)) {
        if (e.right.value == 1) {
          this.outi(`DEV z_A`, `--`);
        } else if ((e.right.value & 0xff00) == 0) {
          // anything - byte constant
          this.compileExpression(e.left);
          this.outi(`SIV ${e.right.value},z_A`, `- byte constant`);
        }
        this.compiler.cached.z_A = "";
        return;
      }
      if (e.op == "*") {
        // anything * power of 2 (or vice versa)
        const shift = Math.log2(constSide.value);
        if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
          this.compileExpression(otherSide);
          this.outi(`MIV ${shift}, z_B JPS __shl16`);
          this.compiler.cached.z_A = "";
          return;
        }
      }
    }

    // evaluate left, save; evaluate right into __A, move to __B; restore left into __A
    this.compileExpression(e.left);
    this.emitHWPushZA();

    this.compileExpression(e.right);
    this.outi(`MVV z_A,z_B`);
    this.emitHWPopZA();
    // now __A = left, __B = right

    switch (e.op) {
      case "+":
        this.outi(`AVV z_B,z_A`, `z_A += z_B`);
        break;
      case "-":
        this.outi(`SVV z_B,z_A`, `z_A -= z_B`);
        break;
      case "*":
        this.outi(`JPS __mul16`, `*`);
        this.compiler.runtimeUsed.add("mul16");
        break;
      case "/":
        this.outi(`JPS __div16`, `/ (divisor magnitude must fit in a byte)`);
        this.compiler.runtimeUsed.add("div16");
        break;
      case "and":
        this.outi(`JPS __and16`, `and`);
        this.compiler.runtimeUsed.add("and16");
        break;
      case "or":
        this.outi(`JPS __or16`, `or`);
        this.compiler.runtimeUsed.add("or16");
        break;
      case "xor":
        this.outi(`JPS __xor16`, `xor`);
        this.compiler.runtimeUsed.add("xor16");
        break;
      case "<<":
        this.outi(`JPS __shl16`, `<<`);
        this.compiler.runtimeUsed.add("shl16");
        break;
      case ">>":
        this.outi(`JPS __shr16`, `>> (logical)`);
        this.compiler.runtimeUsed.add("shr16");
        break;
      default:
        throw new Error(`Unhandled binary operator '${e.op}'`);
    }
  }

  // Comparisons: ported from MIN's RelExpr. Left in __A, pushed; right computed into
  // __A then moved to __B; combine into __B via negate+add (or plain subtract for
  // <=/>=/>) and branch on sign to produce 0xffff/0x0000 in __A.
  compileComparison(e: ComparisonExpression) {
    this.compileExpression(e.left);
    this.emitHWPushZA();

    this.compileExpression(e.right);
    this.outi(`MVV z_A,z_B`);

    const trueLabel = this.compiler.nextLabel("cmp_true");
    const doneLabel = this.compiler.nextLabel("cmp_done");

    switch (e.op) {
      // PLS after each JPS to discard the
      case "<":
        this.outi("JPS __lt16", "<");
        this.compiler.runtimeUsed.add("lt16");
        break;
      case ">":
        this.outi("JPS __gt16", "<");
        this.compiler.runtimeUsed.add("gt16");
        break;
      case "==":
        this.outi("JPS __eq16", "==");
        this.compiler.runtimeUsed.add("eq16");
        break;
      case "!=":
        this.outi("JPS __neq16", "==");
        this.compiler.runtimeUsed.add("neq16");
        break;
      case "<=":
        this.outi("JPS __lteq16", "==");
        this.compiler.runtimeUsed.add("lteq16");
        break;
      case ">=":
        this.outi("JPS __gteq16", "==");
        this.compiler.runtimeUsed.add("gteq16");
        break;
      default:
        throw new Error(`Unhandled comparison operator '${e.op}'`);
    }

    this.outi("PLS PLS", "discard saved left expr off stack");
  }

  emitHeader() {
    this.out("");
    this.out(`; ---- expression compiler zero-page working storage ----`);
    this.out(`#org ${hexWord(ZP_BASE)}`);
    this.out(
      `z_FP:    ${hexWord(VIRTUAL_STACK_BASE)}    ; virtual stack pointer (not the hardware stack pointer)`,
    );
    this.out(`z_PTR:    0x0000    ; ptr to current var in runtime stack`);
    this.out(`z_A:      0x0000    ; acc / expr result / fn return value`);
    this.out(`z_B:      0x0000    ; secondary operand`);
    this.out(`z_C:      0x0000    ; scratch (mul/div/cmp)`);
    this.out(`z_D:      0x0000    ; scratch (div quotient)`);
    this.out(`z_cnt:    0x00      ; loop counter (mul/div/shifts)`);
    this.out(`z_flag:   0x00      ; sign flag (div)`);
    this.out(``);
  }

  emitRuntime() {
    this.out("");
    this.out(`; --- runtime library ---`);
    this.out(`#page`);
    this.compiler.runtimeUsed.forEach((x) => {
      const code = runtime[x];
      if (!code) throw new Error(`Unable to find runtime code for ${x}`);
      code.split("\n").forEach((line) => this.out(line));
    });
  }
}
