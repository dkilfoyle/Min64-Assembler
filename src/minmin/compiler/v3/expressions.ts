import {
  BinaryExpression,
  ComparisonExpression,
  isBinaryExpression,
  isCharLiteral,
  isComparisonExpression,
  isFunctionCall,
  isNumberLiteral,
  isStringLiteral,
  isUnaryExpression,
  isVariableReference,
  NumberLiteral,
  UnaryExpression,
  type Expression,
} from "../../ls/generated/ast";
import { emitRuntimeCall, nextLabel, out } from "./compiler";
import { MinCompileError, hexWord } from "../utils";
import { compileVariableReference, type IExpressionType } from "./variables";
import { compileFunctionCall } from "./functions";
import { frameStack } from "./stack";
import { cached } from "./cache";
import { compileCharLiteral, compileStringLiteral } from "./strings";
import { isArrayExpression } from "./arrays";

/*
Expressions can evaluate to a scalar value (int or char) or a pointer (int* or char*)
if scalar then z_A = value of the scalar
if pointer then z_A = address, z_B = numBytes
*/

const VIRTUAL_STACK_BASE = 0xefff;
export const ZP_BASE = 0x00;

export function reset() {}

export function emitHWPushZ(z = "z_A") {
  out(`LDZ ${z}+0 PHS LDZ ${z}+1 PHS`, `push ${z} onto hardware stack`);
}

export function emitHWPopZ(z = "z_A") {
  out(`PLS SDZ ${z}+1 PLS SDZ ${z}+0`, `pop ${z}   from hardware stack`);
}

export function constEval(expr: Expression): number | undefined {
  switch (true) {
    case isNumberLiteral(expr):
      return expr.value;
    case isUnaryExpression(expr):
      if (expr.op === "-") {
        const u = constEval(expr.inner);
        if (u === undefined) return undefined;
        return -u;
      } else throw new MinCompileError("unsupported constant expression", expr);
    case isBinaryExpression(expr): {
      const l = constEval(expr.left);
      const r = constEval(expr.right);
      if (l === undefined || r === undefined) return undefined;
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
    default: // eg a variable
      return undefined;
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
      throw new MinCompileError(`Unsupported expression: ${JSON.stringify(e)}`, e);
  }
}

/** Evaluate expression into z_A
 * if int or char scalar in z_A
 * if int* or char* pointer in z_A, numBytes in z_B
 **/
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
      resultType = compileNum(e); // result is int
      break;
    case isStringLiteral(e):
      resultType = compileStringLiteral(e); // result is char*
      break;
    case isCharLiteral(e):
      resultType = compileCharLiteral(e); // result is char
      break;
    case isVariableReference(e):
      resultType = compileVariableReference(e); // result is variable type
      break;
    case isFunctionCall(e):
      resultType = compileFunctionCall(e); // result is return statement type
      break;
    case isUnaryExpression(e):
      resultType = compileUnary(e); // result is int
      break;
    case isBinaryExpression(e):
      resultType = compileBinary(e); // result is int
      break;
    case isComparisonExpression(e):
      resultType = compileComparison(e); // result is int
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
  const resultType = compileExpression(e.inner);
  if (resultType.endsWith("*")) {
    throw new MinCompileError("Unary expression on pointer type is not supported", e);
  }
  if (e.op === "-") {
    out(`NEV z_A`, `z_A = -z_A`);
  } else {
    out(`NOV z_A`, `z_A = !z_A`);
  }
  return "int";
}

function compileBinary(e: BinaryExpression): IExpressionType {
  if (isArrayExpression(e.left) || isStringLiteral(e.left)) {
    throw new MinCompileError("Binary expression on array or string is not supported", e.left);
  }
  if (isArrayExpression(e.right) || isStringLiteral(e.right)) {
    throw new MinCompileError("Binary expression on array or string is not supported", e.right);
  }
  const constSide = isNumberLiteral(e.left) ? e.left : isNumberLiteral(e.right) ? e.right : null;
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
  if (isArrayExpression(e.left) || isStringLiteral(e.left)) {
    throw new MinCompileError("Binary expression on array or string is not supported", e.left);
  }
  if (isArrayExpression(e.right) || isStringLiteral(e.right)) {
    throw new MinCompileError("Binary expression on array or stringis not supported", e.right);
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
