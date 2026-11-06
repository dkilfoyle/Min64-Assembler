import type { AstNode } from "langium";
import { MinCompileError, hexByte, hexWord } from "../utils";
import {
  isConstExpression,
  isNumberLiteral,
  isVariableReference,
  type Expression,
  type VariableAssignment,
  type VariableCalcAssignment,
  type VariableDeclaration,
  type VariableReference,
} from "../../ls/generated/ast";
import { emitRuntimeCall, out, runtimeUsed } from "./compiler";
import { compileCompoundExpression, compileExpression, constEval, isArrayExpression } from "./expressions";
import { emitGetPtr, emitGetArrayPtr } from "./pointers";
import { emitRTPushZ, frameStack } from "./stack";
import { cached } from "./cache";

export type IExpressionType = "int" | "char" | "char*";

export interface IVariable {
  name: string;
  kind: "param" | "local";
  type: IExpressionType;
  location: "stack" | "globalStack" | "zeroPage" | "absolute";
  // global is for variables stored in the global stack frame and address is the absolute address in memory
  address: number; // for stack var this is the offset from the frame pointer
  count?: number; // for array types, the number of elements
}

export function emitCopyZToPtr(z: string, ptr: string, type: IExpressionType, comment?: string) {
  if (type === "int") {
    out(`MZT ${z}+0,${ptr} INV ${ptr}`, comment || `copy LSB of ${z} to ${ptr}`);
    out(`MZT ${z}+1,${ptr} DEV ${ptr}`, comment || `copy MSB of ${z} to ${ptr}`);
  } else {
    out(`MZT ${z}+0,${ptr}`, comment || `copy char from ${z} to ${ptr}`);
  }
}

export function emitCopyZToAddr(z: string, addr: number, type: IExpressionType, comment?: string) {
  out(`MZB ${z}+0,${hexWord(addr)}`, comment || `copy LSB of ${z} to ${hexWord(addr)}`);
  if (type == "int") {
    out(`MZB ${z}+1,${hexWord(addr + 1)}`, comment || `copy MSB of ${z} to ${hexWord(addr + 1)}`);
  }
}

export function emitCopyPtrToZ(ptr: string, z: string, type: IExpressionType, comment?: string) {
  if (type === "int") {
    out(`MTZ ${ptr},${z}+0 INV ${ptr}`, comment || `copy LSB of ${z} to ${ptr}`);
    out(`MTZ ${ptr},${z}+1 DEV ${ptr}`, comment || `copy MSB of ${z} to ${ptr}`);
  } else {
    out(`MTZ ${ptr},${z}+0`, comment || `copy char from ${ptr} to ${z}`);
  }
}

export function emitCopyZToVar(sourceZ: string, varName: string, varIndex?: Expression | number) {
  if (sourceZ !== "z_A") throw new MinCompileError(`Unsupported sourceZ ${sourceZ} for copying into variable ${varName}`);
  const { frame, varInfo } = frameStack.getVariable(varName);

  switch (varInfo.location) {
    case "stack":
      // copying from z_A on to the stack
      if (varInfo.address > 255) throw new MinCompileError(`Maximum frame size is 255, got ${varInfo.address} for ${varName}`);
      emitGetPtr("z_PTR", varName, varIndex, true);
      emitCopyZToPtr("z_A", "z_PTR", varInfo.type);
      return;
    case "zeroPage":
      // copying from z_A on to zeroPage
      if (varIndex) {
        emitGetPtr("z_PTR", varName, varIndex, true);
        emitCopyZToPtr("z_A", "z_PTR", varInfo.type);
      } else {
        if (varInfo.type == "int") {
          out(`MVV z_A,${hexByte(varInfo.address)}`, `${frame.name}.${varInfo.name}:int = z_A ()`);
        } else {
          out(`MZZ z_A+0,${hexByte(varInfo.address)}`, `LSB(z_A) -> ${frame.name}.${varInfo.name}`);
        }
      }
      return;
    case "absolute":
      out(`MZB ${sourceZ}+0,${hexWord(varInfo.address)}`, `${frame.name}.${varInfo.name} from ${sourceZ} -> global`);
      out(`MZB ${sourceZ}+1,${hexWord(varInfo.address + 1)}`, `${frame.name}.${varInfo.name} from ${sourceZ} -> global`);
      return;
    case "globalStack":
      out(`MZB ${sourceZ}+0,${hexWord(0xefff - varInfo.address)}`, `${frame.name}.${varInfo.name} from ${sourceZ} -> global`);
      out(`MZB ${sourceZ}+1,${hexWord(0xefff - varInfo.address + 1)}`, `${frame.name}.${varInfo.name} from ${sourceZ} -> global`);
      return;
    default:
      throw new MinCompileError(`Unsupported location for variable ${varName}`);
  }
}

/** z_PTR = &VarOnStack z_A/B = **z_PTR */
export function emitCopyVarToZ(targetAddr: number | string, varName: string, varIndex?: Expression) {
  const { frame, varInfo } = frameStack.getVariable(varName);
  cached.setZA(
    targetAddr.toString() + (varIndex ? `[${typeof varIndex === "number" ? varIndex : varIndex.$cstNode?.text}]` : ""),
    varInfo.type,
  );

  // ensure valid targetAddr which must be in zero page
  if (typeof targetAddr === "number" && targetAddr > 0xff) throw new MinCompileError(`Target address ${targetAddr} is not zero-page`);
  if (typeof targetAddr === "string" && ["z_A", "z_B", "z_C", "z_D"].includes(targetAddr) == false)
    throw new MinCompileError(`Target address ${targetAddr} is not a valid z target`);

  // calculate target LSB and MSB addresses
  const targetLSB = typeof targetAddr === "number" ? hexByte((targetAddr + 0) & 0xff) : `${targetAddr}+0`;
  const targetMSB = typeof targetAddr === "number" ? hexByte((targetAddr + 1) & 0xff) : `${targetAddr}+1`;

  if (varInfo.type == "int") {
    switch (varInfo.location) {
      case "stack":
        emitGetPtr("z_PTR", varName, varIndex, false);
        emitCopyPtrToZ("z_PTR", "z_A", varInfo.type, `copy ${varInfo.name} from stack to z_A`);
        return;
      case "zeroPage":
        out(`MVV ${hexByte(varInfo.address)},${targetLSB}`, `copy ${varInfo.name} from zeroPage to ${targetAddr}`);
        return;
      case "globalStack":
        out(`MWV ${hexWord(0xefff - varInfo.address - 1)},${targetLSB}`, `copy ${varInfo.name} from global to ${targetAddr}`);
        return;
      case "absolute":
        out(`MWV ${hexWord(varInfo.address)},${targetLSB}`, `copy ${varInfo.name} from global to ${targetAddr}`);
        return;
    }
  } else {
    switch (varInfo.location) {
      case "stack":
        emitGetPtr("z_PTR", varName, varIndex, false); // z_PTR = &varName
        out(`MTZ z_PTR,${targetLSB} JPS __signext`, `copy ${varInfo.name} from stack to ${targetAddr}`);
        return;
      case "zeroPage":
        out(`MZZ ${hexByte(varInfo.address)},${targetLSB} JPS __signext`, `copy ${varInfo.name} from zeroPage to ${targetAddr}`);
        return;
      case "globalStack":
        out(`MBB ${hexWord(0xefff - varInfo.address)},${targetLSB}`, `copy ${varInfo.name} from global to ${targetAddr}`);
        return;
      case "absolute":
        out(`MBZ ${hexWord(varInfo.address)},${targetLSB} JPS __signext`, `copy ${varInfo.name} from global to ${targetAddr}`);
        return;
    }
  }
}

function compileVariableAtDeclaration(node: VariableDeclaration, varInfo: IVariable) {
  if (node.assignExpr) {
    // char posx @ 0x00c0 = x
    if (node.assignExpr.exprs.length !== 1)
      throw new MinCompileError(`Expected a single assignment expression for variable @ declaration`, node.assignExpr);
    const assignType = compileExpression(node.assignExpr.exprs[0]);
    if (!varInfo.type.startsWith(assignType)) throw new MinCompileError(`Type mismatch for variable @ declaration`, node.assignExpr.exprs[0]);
    emitCopyZToAddr("z_A", varInfo.address, assignType, `copy z_A to ${varInfo.address}`);
  } else {
    // char r @ 0x00ff
    // do nothing
  }
}

function isArrayAssignDecl(node: VariableDeclaration): { isArrayAssign: boolean; assignCount: number } {
  return {
    isArrayAssign: node.assignExpr != undefined && node.assignExpr.exprs.length > 1,
    assignCount: node.assignExpr ? node.assignExpr.exprs.length : 0,
  };
}

function isArraySizeDecl(node: VariableDeclaration): { isArraySize: boolean; sizeCount: number } {
  // int a = a[0|n] where n is a numeric literal
  const res = {
    isArraySize: false,
    sizeCount: 0,
  };
  if (!node.assignExpr) return res;
  if (node.assignExpr.exprs.length !== 1) return res;
  const rhs = node.assignExpr.exprs[0];
  if (isVariableReference(rhs) && rhs.varName.$refText === node.name && !!rhs.index) {
    const index = rhs.index;
    if (index.startExpr && constEval(index.startExpr) !== 0) throw new MinCompileError(`Start index must be 0 or undefined`, index.startExpr);
    if (!index.endExpr) throw new MinCompileError(`End index must be specified`, index);
    try {
      res.sizeCount = constEval(index.endExpr) + 1; // +1 as array slice is inclusive of start and end
    } catch {
      throw new MinCompileError(`Array size must be a constant`, index.endExpr);
      // TODO: implement handling for runtime specified array size
    }
    res.isArraySize = true;
    return res;
  }
  return res;
}
export function compileVariableDeclaration(node: VariableDeclaration) {
  const { isArrayAssign, assignCount } = isArrayAssignDecl(node);
  const { isArraySize, sizeCount } = isArraySizeDecl(node);
  const varInfo = frameStack.addLocalVariable(node, assignCount || sizeCount);
  const elemSize = varInfo.type == "int" ? 2 : 1;

  if (node.atExpr) return compileVariableAtDeclaration(node, varInfo);

  if (node.assignExpr) {
    if (isArraySize) {
      // int a = a[0|n]
      out(`MIV ${hexWord(sizeCount * elemSize)},z_TMP1 AVV z_TMP1,z_SP`, "Advance z_SP by size of array");
    } else if (isArrayAssign) {
      // int a = 1_2_3
      compileCompoundExpression(node.assignExpr, varInfo.type, "z_SP");
    } else {
      // not an array
      // int a = 6
      compileExpression(node.assignExpr.exprs[0]); // z_A = result of expression
      emitCopyZToVar("z_A", varInfo.name);
    }
  } else {
    // variable has no initializer, so we need to allocate space for it
    varInfo.type == "char"
      ? out(`INV z_SP`, `Allocate space for uninitialized char`)
      : out(`INV z_SP INV z_SP`, `Allocate space for uninitialized int`);
  }
}

export function compileVariableAssignment(node: VariableAssignment) {
  const lhsVarName = node.varName.$refText;
  const { varInfo: lhs } = frameStack.getVariable(lhsVarName);
  let rhs = node.assignExpr;

  // a = 5
  // a[i] = 5
  // z_PTR2 = &lhs
  // z_PTR = &rhs

  if (lhs.type.endsWith("*")) {
    // TODO: bounds checking
    emitGetPtr("z_PTR2", lhsVarName, node.indexExpr); // z_PTR2 = &lhs[index]
    if (rhs.exprs.length == 1) {
      // a[i] = x
      const exprType = compileExpression(rhs.exprs[0]);
      if (exprType.endsWith("*")) {
        // z_A = heap address of rhs[0]
        out(`MVV z_A,z_PTR`); // prepare source pointer for memCopy
        emitRuntimeCall("memCopy", "copy z_B bytes from z_PTR to z_PTR2");
      } else {
        out(`MZT z_A+0,z_PTR2 INV z_PTR2`); // store the value into the pointer location
        if (lhs.type === "int*") out(`MZT z_A+1,z_PTR2`); // store the value into the pointer location
      }
    } else if (rhs.exprs.length > 1) {
      // rhs is compound expression, eg minos[5] = 1_2_3_4
      compileCompoundExpression(rhs, lhs.type, lhs.name);
    } else throw new MinCompileError(`Unimplemented assignment rhs int* = ${rhs.$type}`, rhs);
  } else {
    // lhs is not a pointer, so rhs must be a single expression evaluating to an int
    if (rhs.exprs.length != 1) throw new MinCompileError(`Cannot assign compound expression to non-pointer variable`, rhs);
    const exprType = compileExpression(rhs.exprs[0]);
    // if (exprType != "int")
    //   throw new MinCompileError(
    //     `Type mismatch: expected int, got ${exprType}`,
    //     rhs,
    //   );
    emitCopyZToVar("z_A", lhs.name, node.indexExpr);
  }
}

export function compileVariableCalcAssignment(node: VariableCalcAssignment) {
  if (node.value == 0) return; // x += 0
  const varName = node.varName.$refText;
  const { varInfo: lhs } = frameStack.getVariable(varName);

  emitCopyVarToZ("z_A", varName, node.indexExpr); // z_PTR = &varName

  if (node.op === "+=") {
    if (lhs.type === "int") {
      if (node.value <= 0xff) {
        out(`LDI ${hexByte(node.value)} ADV z_A`, `${varName} += ${node.value}`);
      } else {
        out(`LDI ${hexByte(node.value & 0xff)} ADV z_A LDI ${hexByte(node.value >> 8)} AD.Z z_A+1`, `${varName} += ${node.value}`);
      }
      emitCopyZToVar("z_A", varName);
    } else {
      out(`LDI ${hexByte(node.value)} AD.T z_PTR `, `${varName} += ${node.value}`);
    }
  } else {
    if (lhs.type === "int") {
      // TODO: check if this works
      out(`LDI ${hexByte(node.value & 0xff)} SU.T z_PTR `, `${varName} -= ${node.value}`);
      out(`LDI ${hexByte(node.value >> 8)} SU.T z_PTR+1`, `${varName} -= ${node.value}`);
    } else {
      out(`LDI ${hexByte(node.value)} SU.T z_PTR `, `${varName} -= ${node.value}`);
    }
  }
}

export function compileVariableReference(e: VariableReference): IExpressionType {
  const varName = e.varName.$refText;
  const { varInfo } = frameStack.getVariable(varName);

  if (isArrayExpression(e)) {
    // eg a[0|4]  a[|4]  a[x|y]
    if (e.isAddress) throw new MinCompileError(`Cannot take address of array slice`, e);
    emitGetArrayPtr("z_A", e); // z_A = &a[slicestart], z_CNT = num items, z_B = num bytes
    return varInfo.type; // int* or char*
  } else {
    // eg a or a[5] or &a
    if (e.isAddress) {
      emitGetPtr("z_A", varName, e.index?.startExpr);
      if (varInfo.type.endsWith("*")) throw new MinCompileError(`Cannot take address of pointer type`, e);
      return (varInfo.type + "*") as IExpressionType; // int* or char*
    } else {
      emitCopyVarToZ("z_A", varName, e.index?.startExpr);
      return varInfo.type; // int or char
    }
  }
}
