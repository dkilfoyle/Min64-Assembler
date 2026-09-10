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
} from "../../ls/generated/ast";
import { cached, nextLabel, out, outi, runtimeUsed } from "./compiler";
import { CompileError, hexWord } from "../utils";
import { compileVariableReference } from "./variables";
import { compileFunctionCall } from "./functions";
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

export function reset() {}

function emitHWPushZA() {
  outi(`LDZ z_A+0 PHS LDZ z_A+1 PHS`, `push z_A onto hardware stack`);
}

function emitHWPopZA() {
  outi(`PLS SDZ z_A+1 PLS SDZ z_A+0`, `pop z_A from hardware stack`);
}

export function constEval(expr: Expression): number {
  switch (true) {
    case isNumberLiteral(expr):
      return expr.value;
    case isUnaryExpression(expr):
      if (expr.op === "-") return -constEval(expr.inner);
      throw new CompileError("unsupported constant expression", expr);
    case isBinaryExpression(expr): {
      const l = constEval(expr.left);
      const r = constEval(expr.right);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return Math.floor(l / r);
        default:
          throw new CompileError("unsupported constant expression", expr);
      }
    }
    default:
      throw new CompileError("expected a constant expression", expr);
  }
}

/** Compile expr, leaving the 16-bit result in the z_A zero-page word. */
export function compileExpression(e: Expression): void {
  switch (true) {
    case isNumberLiteral(e):
      return compileNum(e);
    case isVariableReference(e):
      return compileVariableReference(e);
    case isFunctionCall(e):
      return compileFunctionCall(e);
    case isUnaryExpression(e):
      return compileUnary(e);
    case isBinaryExpression(e):
      return compileBinary(e);
    case isComparisonExpression(e):
      return compileComparison(e);
    default:
      throw new CompileError(`Unsupported expression: ${JSON.stringify(e)}`, e);
  }
}

function compileNum(e: NumberLiteral) {
  const valueStr = `const ${e.value}`;
  if (cached.z_A == valueStr) return;
  outi(`MIV ${hexWord(e.value)},z_A`, valueStr);
  cached.z_A = valueStr;
}

function compileUnary(e: UnaryExpression) {
  compileExpression(e.inner);
  if (e.op === "-") {
    outi(`NEV z_A`, `unary -`);
  } else {
    outi(`NOV z_A`, `unary not (bitwise complement)`);
  }
}

function compileBinary(e: BinaryExpression) {
  const constSide = isNumberLiteral(e.left)
    ? e.left
    : isNumberLiteral(e.right)
      ? e.right
      : null;
  const otherSide = constSide === e.left ? e.right : e.left;

  if (constSide) {
    // constant operand optimisations
    if (e.op == "+") {
      compileExpression(otherSide);
      if (constSide.value == 1) {
        outi(`INV z_A`, `++`);
      } else if ((constSide.value & 0xff00) == 0) {
        // anything + byte constant (or vice versa)
        outi(`AIV ${constSide.value},z_A`, `+ byte constant`);
      } else {
        // anything + byte constant (or vice versa)
        outi(`MIV ${constSide.value},z_B AVV z_B,z_A`, `+ word constant`);
      }
      cached.z_A = "";
      return;
    }
    if (e.op == "-" && isNumberLiteral(e.right)) {
      if (e.right.value == 1) {
        outi(`DEV z_A`, `--`);
      } else if ((e.right.value & 0xff00) == 0) {
        // anything - byte constant
        compileExpression(e.left);
        outi(`SIV ${e.right.value},z_A`, `- byte constant`);
      }
      cached.z_A = "";
      return;
    }
    if (e.op == "*") {
      // anything * power of 2 (or vice versa)
      const shift = Math.log2(constSide.value);
      if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
        compileExpression(otherSide);
        outi(`MIV ${shift}, z_B JPS __shl16`);
        cached.z_A = "";
        return;
      }
    }
  }

  // evaluate left, save; evaluate right into __A, move to __B; restore left into __A
  compileExpression(e.left);
  emitHWPushZA();

  compileExpression(e.right);
  outi(`MVV z_A,z_B`);
  emitHWPopZA();
  // now __A = left, __B = right

  switch (e.op) {
    case "+":
      outi(`AVV z_B,z_A`, `z_A += z_B`);
      break;
    case "-":
      outi(`SVV z_B,z_A`, `z_A -= z_B`);
      break;
    case "*":
      outi(`JPS __mul16`, `*`);
      runtimeUsed.add("mul16");
      break;
    case "/":
      outi(`JPS __div16`, `/ (divisor magnitude must fit in a byte)`);
      runtimeUsed.add("div16");
      break;
    case "and":
      outi(`JPS __and16`, `and`);
      runtimeUsed.add("and16");
      break;
    case "or":
      outi(`JPS __or16`, `or`);
      runtimeUsed.add("or16");
      break;
    case "xor":
      outi(`JPS __xor16`, `xor`);
      runtimeUsed.add("xor16");
      break;
    case "<<":
      outi(`JPS __shl16`, `<<`);
      runtimeUsed.add("shl16");
      break;
    case ">>":
      outi(`JPS __shr16`, `>> (logical)`);
      runtimeUsed.add("shr16");
      break;
    default:
      throw new Error(`Unhandled binary operator '${e.op}'`);
  }
}

// Comparisons: ported from MIN's RelExpr. Left in __A, pushed; right computed into
// __A then moved to __B; combine into __B via negate+add (or plain subtract for
// <=/>=/>) and branch on sign to produce 0xffff/0x0000 in __A.
export function compileComparison(e: ComparisonExpression) {
  compileExpression(e.left);
  emitHWPushZA();

  compileExpression(e.right);
  outi(`MVV z_A,z_B`);

  const trueLabel = nextLabel("cmp_true");
  const doneLabel = nextLabel("cmp_done");

  switch (e.op) {
    // PLS after each JPS to discard the
    case "<":
      outi("JPS __lt16", "<");
      runtimeUsed.add("lt16");
      break;
    case ">":
      outi("JPS __gt16", "<");
      runtimeUsed.add("gt16");
      break;
    case "==":
      outi("JPS __eq16", "==");
      runtimeUsed.add("eq16");
      break;
    case "!=":
      outi("JPS __neq16", "==");
      runtimeUsed.add("neq16");
      break;
    case "<=":
      outi("JPS __lteq16", "==");
      runtimeUsed.add("lteq16");
      break;
    case ">=":
      outi("JPS __gteq16", "==");
      runtimeUsed.add("gteq16");
      break;
    default:
      throw new Error(`Unhandled comparison operator '${e.op}'`);
  }

  outi("PLS PLS", "discard saved left expr off stack");
}

export function emitHeader() {
  out("");
  out(`; ---- expression compiler zero-page working storage ----`);
  out(`#org ${hexWord(ZP_BASE)}`);
  out(`z_FP:     0xEFFF    ; frame start pointer`);
  out(`z_PTR:    0x0000    ; ptr to current var in runtime stack`);
  out(`z_A:      0x0000    ; acc / expr result / fn return value`);
  out(`z_B:      0x0000    ; secondary operand`);
  out(`z_C:      0x0000    ; scratch (mul/div/cmp)`);
  out(`z_D:      0x0000    ; scratch (div quotient)`);
  out(`z_cnt:    0x00      ; loop counter (mul/div/shifts)`);
  out(`z_flag:   0x00      ; sign flag (div)`);
  out(``);
}

export function emitRuntime() {
  out("");
  out(`; --- runtime library ---`);
  out(`#page`);
  runtimeUsed.forEach((x) => {
    const code = runtime[x];
    if (!code) throw new Error(`Unable to find runtime code for ${x}`);
    code.split("\n").forEach((line) => out(line));
  });
}
