import { emitCopyZToAddr, emitCopyZToPtr, type IExpressionType, type IVariable } from "./variables";
import { MinCompileError, hexWord } from "../utils";
import {
  CompoundExpression,
  isBinaryExpression,
  isCompoundExpression,
  isConstExpression,
  isNumberLiteral,
  isStringLiteral,
  isVariableReference,
  RangeIndex,
  type Expression,
  type VariableDeclaration,
} from "../../ls/generated/ast";
import { out } from "./compiler";
import { compileExpression, constEval, emitHWPeek, emitHWPopZ, emitHWPushZ } from "./expressions";
import { emitRTPushZ, frameStack } from "./stack";

/*
Instantiation
1. declaration self size
    - eg char vram = vram[0|200]
    - the slice start must be 0 or undefined
    - the slice end must be a numeric literal > 0
    - this just advances z_SP by the size of the array = end - start + 1 (inclusive range)
2. declaration assignment ie where the rhs is an array literal, string literal or a slice
    - eg int bonus = 0_40_120_270_540
    - eg char txt = "hello"
    - eg int numbers = bonus
    - eg int numbers = bonus[2|4]
    - in each case the rhs is pushed element by element on to the stack at z_SP
3. function argument 
    - same cases/handling as declaration assignment
4. assignment to an already declared array
    - eg int minos = minos[0|70]; 
    - minos = 1_2_3;
    - minos[10] = 1_2_3;
    - minos[10] = "hello";
    - minos[10] = bonus;
    - minos[10] = bonus[2|4];
    - in each case the rhs is pushed element by element into the lhs at z_PTR2
5. return value from a function
    - eg return x[1|m]
    - the return value will be a pointer to the array in z_A and length in c_CNT
    - the callerer must handle the return value appropriately, either by using the pointer diretly if the stack is not overwritten
    - or copy the array into the variable length section of the caller's stack frame 
6. variable length arrays
    - eg char buffer = buffer[0|m]
    - the size of the array is determined at runtime
    - the array is allocated in the variable length section of the stack frame placed after the fixed length section of the stack frame
    - access to the array elements is done via a hidden pointer stored in the stack frame
*/

export function getSliceLength(r: RangeIndex): number | undefined {
  if (r.endExpr) {
    const start = r.startExpr ? constEval(r.startExpr) : 0;
    const end = constEval(r.endExpr);
    if (start === undefined || end === undefined) return undefined;
    if (end < start) throw new MinCompileError("Slice end must be greater than start", r);
    return end - start + 1;
  } else throw new MinCompileError("Expecting slice end expression", r);
}

interface IArrayInfo {
  count?: number;
  arrayType: "slice" | "string" | "compound";
}

export function isArrayExpression(e: Expression): IArrayInfo | undefined {
  if (isBinaryExpression(e)) return undefined;
  if (isStringLiteral(e))
    return {
      count: e.value.length,
      arrayType: "string",
    };
  if (!isVariableReference(e)) return undefined;
  const varInfo = frameStack.getVariable(e.varName.$refText, e).varInfo;
  if (!varInfo.type.endsWith("*")) return undefined;
  if (varInfo.location == "absolute") return undefined; // absolute variables are not considered array expressions because length unknown
  if (varInfo.location == "zeroPage") return undefined; // zero page variables are not considered array expressions because length unknown
  if (e.index && e.index.startExpr && !e.index.endExpr) return undefined; // eg a[5] which returns a primary value
  if (e.index && e.index.endExpr) return { count: getSliceLength(e.index), arrayType: "slice" }; // eg a[2|5]
  return { count: varInfo.count, arrayType: "slice" };
}

export function isArray(e?: CompoundExpression): IArrayInfo | undefined {
  if (!e) return undefined;
  if (e.exprs.length > 1) {
    return {
      count:
        e.exprs.reduce<number | undefined>((acc, expr) => {
          const info = isArrayExpression(expr);
          if (info?.count === undefined) return undefined;
          if (acc === undefined) return undefined;
          return acc + info.count;
        }, 0) ?? undefined,
      arrayType: "compound",
    };
  } else if (e.exprs.length == 1) {
    return isArrayExpression(e.exprs[0]);
  } else throw new MinCompileError("Empty compound expression", e); // shouldn't be possible
}

export function isArraySizeDecl(node: VariableDeclaration): undefined | Expression {
  // int a = a[0|n] where n is a numeric literal

  if (!node.assignExpr) return undefined;
  if (node.assignExpr.exprs.length !== 1) return undefined;

  const rhs = node.assignExpr.exprs[0];
  if (isVariableReference(rhs) && rhs.varName.$refText === node.name && !!rhs.index) {
    if (rhs.index.startExpr && constEval(rhs.index.startExpr) !== 0)
      throw new MinCompileError(`Sized array declaration: slice start must be 0 or undefined`, rhs.index.startExpr);
    return rhs.index.endExpr;
  }
  return undefined;
}

export function getCompoundExpressionArraySize(e: CompoundExpression | undefined, type: "int" | "char"): number | undefined {
  if (!e) return undefined;
  let size = 0;
  e.exprs.forEach((expr) => {
    if (isVariableReference(expr)) {
      if (expr.index && expr.index.endExpr) {
        const esize = getSliceLength(expr.index);
        if (esize === undefined) return undefined;
        else size += esize * (type === "int" ? 2 : 1);
      }
    }
    if (isStringLiteral(expr)) {
      size += expr.value.length;
    }
  });
  return size;
}

export function compileCompoundExpression(
  e: CompoundExpression,
  targetPtr: "z_PTR2" | "z_SP" | "z_SP2",
  targetType: "int" | "char" | "unknown",
): void {
  // prerequisite: ptr points to &target[index||0]
  // eg int a = 0_1_2_3 // compile to z_SP
  // eg int a = a[0|3]; a = 0_1_2_3; // compile to z_PTR2
  // eg foo(0_1_2_3) // compile to z_SP
  // eg return 0_1_2_3 // compile to z_SP

  // TODO: Cache/preserve register values

  emitHWPushZ(targetPtr, `save copy ${targetPtr} for compound expression target`);

  for (let i = 0; i < e.exprs.length; i++) {
    const resultType = compileExpression(e.exprs[i]); // this might contaminate Z_PTR2 which is the usual targetPtr
    emitHWPeek(targetPtr, `peek pointer to target for compound expression`);
    if (resultType == "int" || resultType == "char") emitCopyZToPtr("z_A", resultType, targetPtr, targetType);
  }

  out(`PLS PLS`, `Discard saved ${targetPtr}`);
}

export function compileArrayDeclaration(node: CompoundExpression, varInfo: IVariable, sizeExpression: Expression) {
  // int a = a[0|n]
  if (isNumberLiteral(sizeExpression)) {
    // compile time known array size
    const count = constEval(sizeExpression);
    if (count === undefined) throw new MinCompileError(`Cannot determine array size at compile time`, sizeExpression);
    out(`MIV ${hexWord(count * (varInfo.type === "int" ? 2 : 1))},z_TMP1 AVV z_TMP1,z_SP`, "Advance z_SP by size of ${varInfo.type} array");
  } else {
    // variable length array
    // need to compile the array endExpr eg int a = a[0|n] compile n
    compileExpression(sizeExpression); // evaluate the array size expression
    // advance the stack pointer by the array size
    out(`AIV ${hexWord(1)},z_A`, `z_A = array count = endExpr+1`);
    if (varInfo.type === "int") out(`LLZ z_A`, `Multiply array count by 2 for int`);
    out(`AVV z_A,z_SP`, `Advance z_SP to reserve space for variable length array`);
  }
}
