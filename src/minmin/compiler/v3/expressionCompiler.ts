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

  private pushWord(addr: number) {
    this.out(
      `LDZ ${hexByte(addr)} PHS LDZ ${hexByte(addr + 1)} PHS`,
      `push *(${hexByte(addr)})`,
    );
  }

  private popWord(addr: number) {
    this.out(
      `PLS STZ ${hexByte(addr + 1)} PLS STZ ${hexByte(addr)}`,
      `pop to ${hexByte(addr)}`,
    );
  }

  private emitRTPushZA() {
    this.out(`MZT zA+0,z_FP INV z_FP MZT zA+1,z_FP INV z_FP`, `push z_A`);
  }

  private emitRTPopZA() {
    this.out(`INV z_FP STZ zA+1 INV z_FP STZ z_A+0`, `pop to z_A`);
  }

  private emitHWPushZA() {
    this.out(`LDZ zA+0 PHS LDZ zA+1 PHS`, `push z_A onto hardware stack`);
  }

  private emitHWPopZA() {
    this.out(`PLS STZ zA+1 PLS STZ z_A+0`, `pop z_A from hardware stack`);
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
      case isBinaryExpression(e):
        return this.compileBinary(e);
    }
  }

  private compileNum(e: NumberLiteral) {
    const valueStr = `const ${e.value}`;
    if (this.compiler.cached.z_A == valueStr) return;
    this.out(`MIV ${hexWord(e.value)},z_A`, valueStr);
    this.compiler.cached.z_A = valueStr;
  }

  private compileVar(e: VariableReference) {
    const varName = e.varName.$refText;
    const v = this.compiler.getSymbol(varName, e);

    if (v.location != "stack")
      throw new CompileError(`Non stack variables not supported yet`, e);

    this.compiler.emitCopyVarIntoZ(varName, "z_A");
  }

  private compileCall(e: FunctionCall) {
    const functionName = e.functionName.$refText;
    const f = this.compiler.functions.get(functionName);
    if (!f) throw new CompileError(`Unknown function '${functionName}'`, e);

    for (let i = e.args.length - 1; i >= 0; i--) {
      const arg = e.args[i];
      this.compileExpression(arg.exprs[0]); // result -> z_A
      this.emitRTPushZA(); // push z_A onto runtime stack (lsb, msb)
    }

    this.out(
      `JPS ${functionName}`,
      `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`,
    );

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
          this.out(`INV z_A`, `++`);
        } else if ((constSide.value & 0xff00) == 0) {
          // anything + byte constant (or vice versa)
          this.out(`AIV ${constSide.value},z_A`, `+ byte constant`);
        } else {
          // anything + byte constant (or vice versa)
          this.out(`MIV ${constSide.value},z_B AVV z_B,z_A`, `+ word constant`);
        }
        this.compiler.cached.z_A = "";
        return;
      }
      if (e.op == "-" && isNumberLiteral(e.right)) {
        if (e.right.value == 1) {
          this.out(`DEV z_A`, `--`);
        } else if ((e.right.value & 0xff00) == 0) {
          // anything - byte constant
          this.compileExpression(e.left);
          this.out(`SIV ${e.right.value},z_A`, `- byte constant`);
        }
        this.compiler.cached.z_A = "";
        return;
      }
      if (e.op == "*") {
        // anything * power of 2 (or vice versa)
        const shift = Math.log2(constSide.value);
        if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
          this.compileExpression(otherSide);
          this.out(`MIV ${shift}, z_B JPS __shl16`);
          this.compiler.cached.z_A = "";
          return;
        }
      }
    }

    // evaluate left, save; evaluate right into __A, move to __B; restore left into __A
    this.compileExpression(e.left);
    this.emitHWPushZA();

    this.compileExpression(e.right);
    this.out(`MVV z_A,z_B`);
    this.emitHWPopZA();
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
        this.compiler.runtimeUsed.add("mul16");
        break;
      case "/":
        this.out(`JPS __div16`, `/ (divisor magnitude must fit in a byte)`);
        this.compiler.runtimeUsed.add("div16");
        break;
      case "and":
        this.out(`JPS __and16`, `and`);
        this.compiler.runtimeUsed.add("and16");
        break;
      case "or":
        this.out(`JPS __or16`, `or`);
        this.compiler.runtimeUsed.add("or16");
        break;
      case "xor":
        this.out(`JPS __xor16`, `xor`);
        this.compiler.runtimeUsed.add("xor16");
        break;
      case "<<":
        this.out(`JPS __shl16`, `<<`);
        this.compiler.runtimeUsed.add("shl16");
        break;
      case ">>":
        this.out(`JPS __shr16`, `>> (logical)`);
        this.compiler.runtimeUsed.add("shr16");
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
    this.emitHWPushZA();

    this.compileExpression(e.right);
    this.out(`MVV z_A,z_B`);

    const trueLabel = this.compiler.nextLabel("cmp_true");
    const doneLabel = this.compiler.nextLabel("cmp_done");

    switch (e.op) {
      // PLS after each JPS to discard the
      case "<":
        this.out("JPS __lt16", "<");
        this.compiler.runtimeUsed.add("lt16");
        break;
      case ">":
        this.out("JPS __gt16", "<");
        this.compiler.runtimeUsed.add("gt16");
        break;
      case "==":
        this.out("JPS __eq16", "==");
        this.compiler.runtimeUsed.add("eq16");
        break;
      case "!=":
        this.out("JPS __neq16", "==");
        this.compiler.runtimeUsed.add("neq16");
        break;
      case "<=":
        this.out("JPS __lteq16", "==");
        this.compiler.runtimeUsed.add("lteq16");
        break;
      case ">=":
        this.out("JPS __gteq16", "==");
        this.compiler.runtimeUsed.add("gteq16");
        break;
      default:
        throw new Error(`Unhandled comparison operator '${e.op}'`);
    }

    this.out("PLS PLS", "discard saved left expr off stack");
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
    if (Array.from(this.compiler.runtimeUsed.keys()).length == 0) return;
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
