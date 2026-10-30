import {
  BinaryExpression,
  ComparisonExpression,
  CompoundExpression,
  isBinaryExpression,
  isComparisonExpression,
  isFunctionCall,
  isNumberLiteral,
  isStringLiteral,
  isUnaryExpression,
  isVariableReference,
  NumberLiteral,
  StringLiteral,
  UnaryExpression,
  type Expression,
} from "../../ls/generated/ast";
import { emitRuntimeCall, nextLabel, out } from "./compiler";
import { MinCompileError, hexWord } from "../utils";
import { compileVariableReference, type IExpressionType } from "./variables";
import { compileFunctionCall } from "./functions";
import { frameStack } from "./stack";
import { cached } from "./cache";
import { compileStringLiteral } from "./strings";

const VIRTUAL_STACK_BASE = 0xefff;
export const ZP_BASE = 0x00;

export function reset() {}

export function emitHWPushZ(z = "z_A") {
  out(`LDZ ${z}+0 PHS LDZ ${z}+1 PHS`, `push ${z} onto hardware stack`);
}

export function emitHWPopZ(z = "z_A") {
  out(`PLS SDZ ${z}+1 PLS SDZ ${z}+0`, `pop ${z}   from hardware stack`);
}

export function constEval(expr: Expression): number {
  switch (true) {
    case isNumberLiteral(expr):
      return expr.value;
    case isUnaryExpression(expr):
      if (expr.op === "-") return -constEval(expr.inner);
      throw new MinCompileError("unsupported constant expression", expr);
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
          throw new MinCompileError("unsupported constant expression", expr);
      }
    }
    default:
      throw new MinCompileError("expected a constant expression", expr);
  }
}

export function getExpressionType(e: Expression): string {
  switch (true) {
    case isNumberLiteral(e):
      return e.value > 0xff ? "int" : "char";
    case isVariableReference(e):
      return frameStack.getVariable(e.varName.$refText, e).varInfo.type;
    case isFunctionCall(e):
    case isUnaryExpression(e):
    case isBinaryExpression(e):
    case isComparisonExpression(e):
      return "int";
    default:
      throw new MinCompileError(
        `Unsupported expression: ${JSON.stringify(e)}`,
        e,
      );
  }
}

export function isArrayExpression(e: Expression): boolean {
  if (!isVariableReference(e)) return false;
  const varInfo = frameStack.getVariable(e.varName.$refText, e).varInfo;
  if (!varInfo.type.endsWith("*")) return false;
  if (varInfo.location == "absolute") return false; // absolute variables are not considered array expressions because length unknown
  if (varInfo.location == "zeroPage") return false; // zero page variables are not considered array expressions because length unknown
  if (e.index && e.index.startExpr && !e.index.endExpr) return false; // eg a[5] which returns a primary value
  return true;
}

//*
export function compileCompoundExpression(
  e: CompoundExpression,
  targetType: string,
  targetName: string,
): void {
  // prerequisite: z_PTR2 points to &target[index||0]
  // eg int a = 0_1_2_3
  // eg int a = a[0|3]; a = 0_1_2_3;
  // eg foo(0_1_2_3)
  // eg return 0_1_2_3
  if (targetType != "int*" && targetType != "char*")
    throw new MinCompileError(
      "Compound expression assignment target is not an array",
      e,
    );
  const elementType = targetType === "int*" ? "int" : "char";
  for (let i = 0; i < e.exprs.length; i++) {
    compileExpression(e.exprs[i]);
    if (isArrayExpression(e.exprs[i])) {
      // compiling an array slice puts the slice information in z_PTR (pointer to start), z_CNT (number of items), and z_A (number of bytes)
      emitRuntimeCall(`memCopy`, `copy z_A bytes from z_PTR to z_PTR2`);
    } else {
      if (elementType == "int") {
        out(`MZT z_A+0,z_PTR2 INV z_PTR2`, `move z_A to ${targetName}[${i}]`);
        out(`MZT z_A+1,z_PTR2 INV z_PTR2`);
      } else {
        out(`MZT z_A+0,z_PTR2 INV z_PTR2`, `move z_A to ${targetName}[${i}]`);
      }
    }
  }
}

/** Compile expr, leaving the 16-bit result in the z_A zero-page word. */
export function compileExpression(e: Expression): IExpressionType {
  // TODO: possible optimisations
  // option to preserve z_A or not
  // check if e is a leaf
  // option to compile to different target virtual register eg z_B or z_TEMP

  if (cached.isZA(e)) {
    out("", `cached z_A ${cached.z_A!.id}`);
    return cached.z_A!.type;
  }

  let resultType: IExpressionType;
  switch (true) {
    case isNumberLiteral(e):
      resultType = compileNum(e);
      break;
    case isStringLiteral(e):
      resultType = compileStringLiteral(e);
      break;
    case isVariableReference(e):
      resultType = compileVariableReference(e);
      break;
    case isFunctionCall(e):
      resultType = compileFunctionCall(e);
      break;
    case isUnaryExpression(e):
      resultType = compileUnary(e);
      break;
    case isBinaryExpression(e):
      resultType = compileBinary(e);
      break;
    case isComparisonExpression(e):
      resultType = compileComparison(e);
      break;
    default:
      throw new MinCompileError(`Unsupported expression`, e);
  }
  cached.setZA(e, resultType);
  return resultType;
}

function compileNum(e: NumberLiteral): IExpressionType {
  const valueStr = `const ${e.value}`;
  out(`MIV ${hexWord(e.value)},z_A`, valueStr);
  return "int";
}

function compileUnary(e: UnaryExpression): IExpressionType {
  if (isArrayExpression(e.inner)) {
    throw new MinCompileError("Unary expression on array is not supported", e);
  }
  compileExpression(e.inner);
  if (e.op === "-") {
    out(`NEV z_A`, `z_A = -z_A`);
  } else {
    out(`NOV z_A`, `z_A = !z_A`);
  }
  return "int";
}

function compileBinary(e: BinaryExpression): IExpressionType {
  if (isArrayExpression(e.left)) {
    throw new MinCompileError(
      "Binary expression on array is not supported",
      e.left,
    );
  }
  if (isArrayExpression(e.right)) {
    throw new MinCompileError(
      "Binary expression on array is not supported",
      e.right,
    );
  }
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
        out(`INV z_A`, `++`);
      } else if ((constSide.value & 0xff00) == 0) {
        // anything + byte constant (or vice versa)
        out(`AIV ${constSide.value},z_A`, `+ byte constant`);
      } else {
        // anything + byte constant (or vice versa)
        out(`MIV ${constSide.value},z_B AVV z_B,z_A`, `+ word constant`);
      }
      return "int";
    }
    if (e.op == "-" && isNumberLiteral(e.right)) {
      if (e.right.value == 1) {
        out(`DEV z_A`, `--`);
        return "int";
      } else if ((e.right.value & 0xff00) == 0) {
        // anything - byte constant
        compileExpression(e.left);
        out(`SIV ${e.right.value},z_A`, `- byte constant`);
        return "int";
      }
    } else if (e.op == "*") {
      // anything * power of 2 (or vice versa)
      const shift = Math.log2(constSide.value);
      if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
        compileExpression(otherSide);
        out(`MIV ${shift}, z_B JPS __shl16`);
        return "int";
      }
    }
  }

  // evaluate left, save; evaluate right into __A, move to __B; restore left into __A
  compileExpression(e.left);

  // optimisation - if right is a constant then can move directly to z_B without pushing and popping z_A
  if (isNumberLiteral(e.right)) {
    out(`MIV ${hexWord(e.right.value)},z_B`, `z_B = ${e.right.value}`);
  } else {
    emitHWPushZ("z_A");
    compileExpression(e.right);
    out(`MVV z_A,z_B`);
    emitHWPopZ("z_A");
  }
  // now z_A = left, z_B = right

  switch (e.op) {
    case "+":
      out(`AVV z_B,z_A`, `z_A += z_B`);
      break;
    case "-":
      out(`SVV z_B,z_A`, `z_A -= z_B`);
      break;
    case "*":
      emitRuntimeCall("mul16", `*`);
      break;
    case "/":
      emitRuntimeCall("div16", `/ (divisor magnitude must fit in a byte)`);
      break;
    case "and":
      emitRuntimeCall("and16", `and`);
      break;
    case "or":
      emitRuntimeCall("or16", `or`);
      break;
    case "xor":
      emitRuntimeCall("xor16", `xor`);
      break;
    case "<<":
      emitRuntimeCall("shl16", `<<`);
      break;
    case ">>":
      emitRuntimeCall("shr16", `>> (logical)`);
      break;
    default:
      throw new Error(`Unhandled binary operator '${e.op}'`);
  }
  return "int";
}

// Comparisons: ported from MIN's RelExpr. Left in __A, pushed; right computed into
// __A then moved to __B; combine into __B via negate+add (or plain subtract for
// <=/>=/>) and branch on sign to produce 0xffff/0x0000 in __A.
export function compileComparison(e: ComparisonExpression): IExpressionType {
  if (isArrayExpression(e.left)) {
    throw new MinCompileError(
      "Binary expression on array is not supported",
      e.left,
    );
  }
  if (isArrayExpression(e.right)) {
    throw new MinCompileError(
      "Binary expression on array is not supported",
      e.right,
    );
  }
  compileExpression(e.left);
  emitHWPushZ("z_A");

  compileExpression(e.right);
  out(`MVV z_A,z_B`);
  // now z_A = left, z_B = right

  const trueLabel = nextLabel("cmp_true");
  const doneLabel = nextLabel("cmp_done");

  switch (e.op) {
    // PLS after each JPS to discard the
    case "<":
      emitRuntimeCall("lt16", "<");
      break;
    case ">":
      emitRuntimeCall("gt16", ">");
      break;
    case "==":
      emitRuntimeCall("eq16", "==");
      break;
    case "!=":
      emitRuntimeCall("neq16", "!=");
      break;
    case "<=":
      emitRuntimeCall("lteq16", "<=");
      break;
    case ">=":
      emitRuntimeCall("gteq16", ">=");
      break;
    default:
      throw new Error(`Unhandled comparison operator '${e.op}'`);
  }

  out("PLS PLS", "discard saved left expr off stack");
  return "int";
}
