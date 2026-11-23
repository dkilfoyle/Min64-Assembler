import { MinCompileError, hexByte, hexWord } from "../utils";
import {
  type Expression,
  type VariableAssignment,
  type VariableCalcAssignment,
  type VariableDeclaration,
  type VariableReference,
} from "../../ls/generated/ast";
import { emitRuntimeCall, out } from "./compiler";
import { compileExpression } from "./expressions";
import { emitRTPushZ, frameStack } from "./stack";
import { cached } from "./cache";
import { emitGetPtr, emitGetArrayPtr } from "./pointers";
import { compileArrayDeclaration, compileCompoundExpression, isArray, isArrayExpression, isArraySizeDecl } from "./arrays";

export type IExpressionType = "int" | "char" | "char*" | "int*" | "unknown";

export interface IVariable {
  name: string;
  kind: "param" | "local" | "return";
  type: IExpressionType;
  location: "stack" | "zeroPage" | "absolute";
  // global is for variables stored in the global stack frame and address is the absolute address in memory
  address: number; // for stack var this is the offset from the frame pointer
  count?: number; // for array types, the number of elements
}

export function emitCopyZToPtr(
  z: string,
  zType: IExpressionType,
  targetPtr: "z_PTR2" | "z_SP" | "z_SP2",
  targetType: "int" | "char" | "unknown",
  comment?: string,
) {
  switch (zType) {
    case "char":
      if (targetType == "int") out(`JPS __signext`, `sign extend char in z_A to int`);
      out(`MZT ${z}+0,${targetPtr} INV ${targetPtr}`, comment || `move char ${z}+0 to ${targetPtr}`);
      if (targetType == "int") out(`MZT ${z}+1,${targetPtr} INV ${targetPtr}`, comment || `move signExtended ${z}+1 to ${targetPtr}`);
      break;
    case "int":
      out(`MZT ${z}+0,${targetPtr} INV ${targetPtr}`, comment || `move int ${z}+0 to ${targetPtr}`);
      if (targetType != "char") out(`MZT ${z}+1,${targetPtr} INV ${targetPtr}`, comment || `move int ${z}+1 to ${targetPtr}`);
      break;
    case "char*":
    case "int*":
      if (z != "z_A") throw new MinCompileError("Pointer copy only supported from z_A");
      switch (targetPtr) {
        case "z_SP":
          return emitRuntimeCall(`memCopySP`, comment || `copy z_B bytes from **${z} to z_SP`);
        case "z_PTR2":
          return emitRuntimeCall(`memCopyPTR2`, comment || `copy z_B bytes from **${z} to z_PTR2`);
      }
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
      emitGetPtr("z_PTR2", varName, varIndex, true);
      emitCopyZToPtr("z_A", varInfo.type, "z_PTR2", varInfo.type.startsWith("int") ? "int" : "char");
      return;
    case "zeroPage":
      // copying from z_A on to zeroPage
      if (varIndex) {
        emitGetPtr("z_PTR2", varName, varIndex, true);
        emitCopyZToPtr("z_A", varInfo.type, "z_PTR2", varInfo.type.startsWith("int") ? "int" : "char");
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
    // case "globalStack":
    // out(`MZB ${sourceZ}+0,${hexWord(0xefff - varInfo.address)}`, `${frame.name}.${varInfo.name} from ${sourceZ} -> global`);
    // out(`MZB ${sourceZ}+1,${hexWord(0xefff - varInfo.address + 1)}`, `${frame.name}.${varInfo.name} from ${sourceZ} -> global`);
    // return;
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
      // case "globalStack":
      // out(`MWV ${hexWord(0xefff - varInfo.address - 1)},${targetLSB}`, `copy ${varInfo.name} from global to ${targetAddr}`);
      // return;
      case "absolute":
        out(`MWV ${hexWord(varInfo.address)},${targetLSB}`, `copy ${varInfo.name} from global to ${targetAddr}`);
        return;
    }
  } else {
    switch (varInfo.location) {
      case "stack":
        emitGetPtr("z_PTR", varName, varIndex, false); // z_PTR = &varName
        out(`MTZ z_PTR,${targetLSB}`, `copy ${varInfo.name} from stack to ${targetAddr}`);
        break;
      case "zeroPage":
        out(`MZZ ${hexByte(varInfo.address)},${targetLSB}`, `copy ${varInfo.name} from zeroPage to ${targetAddr}`);
        break;
      // case "globalStack":
      // out(`MBB ${hexWord(0xefff - varInfo.address)},${targetLSB}`, `copy ${varInfo.name} from global to ${targetAddr}`);
      // break;
      case "absolute":
        out(`MBZ ${hexWord(varInfo.address)},${targetLSB}`, `copy ${varInfo.name} from global to ${targetAddr}`);
        break;
    }
    out(`JPS __signext`, `jump to sign extension routine`);
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

export function compileVariableDeclaration(node: VariableDeclaration) {
  // const { varInfo } = frameStack.getVariable(node.name, node);
  const frame = frameStack.current();
  const varInfo = frame.addLocalVariable(node);

  if (node.atExpr) return compileVariableAtDeclaration(node, varInfo);

  // save the new local variables address in the variable table
  emitRTPushZ("z_SP", "z_SP2", "int", `save stack address of local variable ${varInfo.name} in variable table`);

  if (node.assignExpr) {
    // compile the assignment expression to the stack pointer (z_SP)
    compileCompoundExpression(node.assignExpr, "z_SP", node.type);
  } else {
    // make space for future assignment to this variable
    out(`INV z_SP ${varInfo.type == "int" ? "INV z_SP" : ""}`);
  }
}

export function compileVariableAssignment(node: VariableAssignment) {
  const lhsVarName = node.varName.$refText;
  const { varInfo: lhs } = frameStack.getVariable(lhsVarName);
  const rhs = node.assignExpr;
  const lhsBaseType = lhs.type.startsWith("int") ? "int" : "char";

  // a = 5
  // a[i] = 5
  // z_PTR2 = &lhs
  // z_PTR = &rhs

  emitGetPtr("z_PTR2", lhsVarName, node.indexExpr); // z_PTR2 = &lhs[index]
  compileCompoundExpression(rhs, "z_PTR2", lhsBaseType);
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
      // &a
      emitGetPtr("z_A", varName, e.index?.startExpr);
      if (varInfo.type.endsWith("*")) throw new MinCompileError(`Cannot take address of pointer type`, e);
      return (varInfo.type + "*") as IExpressionType; // int* or char*
    } else {
      // a or a[5]
      emitCopyVarToZ("z_A", varName, e.index?.startExpr);
      return varInfo.type; // int or char
    }
  }
}
