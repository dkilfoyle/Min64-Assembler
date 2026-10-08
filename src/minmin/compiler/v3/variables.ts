import type { AstNode } from "langium";
import { MinCompileError, hexByte, hexWord } from "../utils";
import {
  isNumberLiteral,
  isVariableReference,
  type Expression,
  type VariableAssignment,
  type VariableCalcAssignment,
  type VariableDeclaration,
  type VariableReference,
} from "../../ls/generated/ast";
import { cached, out, runtimeUsed } from "./compiler";
import { compileCompoundExpression, compileExpression, constEval, isArrayExpression } from "./expressions";
import { emitGetPtr, emitGetArrayPtr } from "./pointers";

export interface IVariableSymbol {
  name: string;
  kind: "param" | "local";
  type: "int" | "char" | "int*" | "char*";
  location: "stack" | "zeroPage" | "global" | "heap";
  address: number;
  count?: number; // for array types, the number of elements
  // offset (+ve to lower addresses) in the case of location=stack
  // 0x10000 if location=heap (to throw an error if address is used)
}

export interface IStackFrame {
  name: string;
  kind: "function" | "block" | "global";
  variables: Map<string, IVariableSymbol>;
  frameSize: number;
  heapSize: number;
}

export let frameStack: IStackFrame[] = [];

export function reset() {
  frameStack = [];
}

export function currentFrame(node?: AstNode): IStackFrame {
  const frame = frameStack.at(-1);
  if (!frame) throw new MinCompileError("No current stack frame", node);
  return frame;
}

// frame stack
//           ifblock | curFunc | callingFunc | Global
// locals    jjii|xx|yyxx|zz
// fpOffset     0  2    6  8
// i offset 0
// j offset -2
// x offset +2
// y offset unreachable
// z offset +8

/** Get the symbol information for a variable by name, including its frame pointer offset and fully qualified name.
 * returns
 *  { fpOffset:number, // which is positive for prior frames and negative for current frame
 *    fpName:string, // the fully qualified name of the variable
 *    symbolInfo:IVariableSymbol // contains the variable's metadata
 *  }
 */
export function getSymbol(name: string, node?: AstNode): { fpOffset: number; fpName: string; symbolInfo: IVariableSymbol } {
  let fpOffset = 0;
  let fpName = name;
  let inReach = true;

  for (let i = frameStack.length - 1; i >= 0; i--) {
    const isCurrentFrame = i === frameStack.length - 1;
    const isGlobalFrameOnly = frameStack.length == 1;
    if (!(isCurrentFrame || isGlobalFrameOnly)) fpOffset += frameStack[i].frameSize;
    const frame = frameStack[i];
    fpName = `${frame.name}.${fpName}`;
    if (inReach || i == 0) {
      // search stack up to function level and global frame
      const symbolInfo = frame.variables.get(name);
      if (symbolInfo) return { fpOffset: fpOffset - symbolInfo.address, fpName, symbolInfo };
    }
    if (frame.kind == "function") inReach = false; // can't search in calling functions
  }

  throw new MinCompileError(`Symbol ${name} not found in frameStack`, node || ({} as AstNode));
}

export function emitCachedZA(instr: string, comment: string, value: string) {
  if (cached.z_A == value) return;
  out(instr, comment);
  cached.z_A = value;
}

export function emitCopyZIntoVar(sourceZ: string, varName: string, varIndex?: Expression | number) {
  if (sourceZ !== "z_A") throw new MinCompileError(`Unsupported sourceZ ${sourceZ} for copying into variable ${varName}`, {} as AstNode);
  const { fpName, fpOffset, symbolInfo: v } = getSymbol(varName);
  if (v.location === "stack") {
    // copying from z_A on to the stack
    if (v.address > 255) throw new MinCompileError(`Maximum frame size is 255, got ${v.address} for ${varName}`, {} as AstNode);
    emitGetPtr("z_PTR", varName, varIndex, true);
    if (v.type == "int") {
      out(`JPS __sdZA`, `${fpName}:int = z_A(${cached.z_A})`);
    } else {
      out(`MZT z_A+0,z_PTR`, `${fpName}:char = z_A(${cached.z_A})`);
    }
    return;
  } else if (v.location === "zeroPage") {
    // copying from z_A on to zeroPage
    if (varIndex) {
      emitGetPtr("z_PTR", varName, varIndex, true);
      runtimeUsed.add("copyZA");
      out(`JPS __copyZA`, `${fpName}:int[${typeof varIndex === "number" ? varIndex : varIndex.$cstNode?.text}] = z_A(${cached.z_A})`);
    } else {
      if (v.type == "int") {
        out(`MVV z_A,${hexByte(v.address)}`, `${varName}:int = z_A ()`);
      } else {
        out(`MZZ z_A+0,${hexByte(v.address)}`, `LSB(z_A) -> ${varName}`);
      }
    }
    return;
  } else if (v.location === "global") {
    out(`MWV ${sourceZ},${hexWord(v.address)}`, `${varName} from ${sourceZ} -> global`);
    return;
  }
  throw new MinCompileError(`Unsupported location for variable ${varName}`);
}

/** z_PTR = &VarOnStack z_A/B = **z_PTR */
export function emitCopyVarIntoZ(targetAddr: number | string, varName: string, varIndex?: Expression) {
  const { fpName, fpOffset, symbolInfo: v } = getSymbol(varName);

  // ensure valid targetAddr which must be in zero page
  if (typeof targetAddr === "number" && targetAddr > 0xff)
    throw new MinCompileError(`Target address ${targetAddr} is not zero-page`, {} as AstNode);
  if (typeof targetAddr === "string" && ["z_A", "z_B", "z_C", "z_D"].includes(targetAddr) == false)
    throw new MinCompileError(`Target address ${targetAddr} is not a valid z target`, {} as AstNode);

  // calculate target LSB and MSB addresses
  const targetLSB = typeof targetAddr === "number" ? hexByte((targetAddr + 0) & 0xff) : `${targetAddr}+0`;
  const targetMSB = typeof targetAddr === "number" ? hexByte((targetAddr + 1) & 0xff) : `${targetAddr}+1`;

  if (v.type === "int") {
    switch (v.location) {
      case "stack":
        emitGetPtr("z_PTR", varName, varIndex, false);
        switch (targetAddr) {
          case "z_A":
            out(`JPS __ldZA`, `${varName} -> z_A`);
            break;
          case "z_B":
            out(`LDI ${v.address} PHS JPS __ldZB PLS`, `z_B=${varName}`);
            break;
          default:
            throw new MinCompileError(`Unsupported target address ${targetAddr}`, {} as AstNode);
        }
        return;
      case "zeroPage":
        out(`MVV ${hexByte(v.address)},${targetLSB}`, `${varName} from zeroPage -> ${targetAddr}`);
        return;
      case "global":
        out(`MWV ${hexWord(v.address)},${targetLSB}`, `${varName} from global -> ${targetAddr}`);
        return;
    }
  } else {
    switch (v.location) {
      case "stack":
        emitGetPtr("z_PTR", varName, varIndex, false); // z_PTR = &varName
        out(`MTZ z_PTR,${targetLSB} JPS __signext`, `${varName} from stack -> ${targetAddr}`);
        return;
      case "zeroPage":
        out(`MZZ ${hexByte(v.address)},${targetLSB} JPS __signext`, `${varName} from zeroPage -> ${targetAddr}`);
        return;
      case "global":
        out(`MBZ ${hexWord(v.address)},${targetLSB} JPS __signext`, `${varName} from global -> ${targetAddr}`);
        return;
    }
  }
}

const getSelfSizeRangeExpr = (node: VariableDeclaration) => {
  if (!node.assignExpr) return false;
  if (node.assignExpr.exprs.length !== 1) return false;
  const expr = node.assignExpr.exprs[0];
  if (isVariableReference(expr) && expr.varName.$refText === node.name && !!expr.index) return expr.index;
  return undefined;
};

export function compileVariableDeclaration(node: VariableDeclaration) {
  const arraySizeDecl = getSelfSizeRangeExpr(node);
  const isArrayAssignDecl = node.assignExpr && node.assignExpr.exprs.length > 1;
  const isArray = arraySizeDecl || isArrayAssignDecl;
  const frame = currentFrame(node);
  const varName = node.name;
  const elementSize = node.type == "int" ? 2 : 1;

  let symbolInfo: IVariableSymbol | undefined;
  if (node.atExpr) {
    const address = constEval(node.atExpr);
    symbolInfo = {
      name: node.name,
      kind: "local",
      type: node.type === "int" ? "int*" : "char*",
      location: address <= 0xff ? "zeroPage" : "global",
      address: address,
    };
    frame.variables.set(varName, symbolInfo);
  } else if (isArray) {
    symbolInfo = {
      name: node.name,
      kind: "local",
      type: node.type === "int" ? "int*" : "char*",
      location: "stack",
      address: frame.frameSize,
    };
    frame.variables.set(varName, symbolInfo);
    frame.frameSize += 2;
  } else {
    symbolInfo = {
      name: node.name,
      kind: "local",
      type: node.type,
      location: "stack",
      address: frame.frameSize,
    };
    frame.variables.set(varName, symbolInfo);
    frame.frameSize += elementSize;
  }

  if (node.assignExpr) {
    if (arraySizeDecl) {
      // int a = a[0|n]
      if (arraySizeDecl.startExpr && constEval(arraySizeDecl.startExpr) !== 0)
        throw new MinCompileError(`Start index must be 0 or undefined`, arraySizeDecl.startExpr);
      if (!arraySizeDecl.endExpr) throw new MinCompileError(`End index must be specified`, arraySizeDecl);

      symbolInfo.count = constEval(arraySizeDecl.endExpr) + 1;
      // will throw error if endExpr is not constant
      // currently does not handle runtime array sizes
      // to do this would need to store the array size at runtime eg first 2 bytes of the array could hold the size

      // store array address (z_HP) into the pointer variable
      emitGetPtr("z_PTR", symbolInfo.name);
      out(`MZT z_HP+1,z_PTR DEV z_PTR`, `ptr ${symbolInfo.name} = z_HP`);
      out(`MZT z_HP+0,z_PTR INV z_PTR`, `ptr ${symbolInfo.name} = z_HP`);

      compileExpression(arraySizeDecl.endExpr); // z_A = length of array
      // TODO: store the evaluated length into the array header at lhs.address+2

      if (symbolInfo.type == "int*") {
        out(`LLV z_A AVV z_A,z_HP`, "Advance z_HP by size of int array");
      } else {
        out(`AVV z_A,z_HP`, "Advance z_HP by size of char array");
      }
    } else if (isArrayAssignDecl) {
      // int a = 1_2_3
      out(`MVV z_HP,z_PTR2`);
      compileCompoundExpression(node.assignExpr, symbolInfo.type, symbolInfo.name);
      out(`MVV z_PTR2,z_HP`, "Update z_HP from z_PTR2");
    } else {
      // not an array
      compileExpression(node.assignExpr.exprs[0]); // z_A = result of expression
      emitCopyZIntoVar("z_A", varName);
    }
  }
}

export function compileVariableAssignment(node: VariableAssignment) {
  const lhsVarName = node.varName.$refText;
  const { symbolInfo: lhs } = getSymbol(lhsVarName);
  let rhs = node.assignExpr;

  // a = 5
  // a[i] = 5
  // z_PTR2 = &lhs
  // z_PTR = &rhs

  if (lhs.type == "int*") {
    // TODO: bounds checking
    if (rhs.exprs.length == 1) {
      // a[i] = x
      emitGetPtr("z_PTR2", lhsVarName, node.indexExpr);
      if (isArrayExpression(rhs.exprs[0])) {
        // rhs is array slice, eg minos[5] = a[0|3]
        const rhsVarRef = rhs.exprs[0] as VariableReference;
        emitGetArrayPtr("z_PTR", rhsVarRef); // z_PTR = &a[slicestart], z_CNT = num item, z_B = num bytes
        out(`JPS __memCopy`); // copy z_A bytes from z_PTR to z_PTR2
        runtimeUsed.add("memCopy");
      } else {
        compileExpression(rhs.exprs[0]);
        out(`MZT z_A+0,z_PTR2 INV z_PTR2 MZT z_A+1,z_PTR2 `); // store the value into the pointer location
      }
    } else if (rhs.exprs.length > 1) {
      // rhs is compound expression, eg minos[5] = 1_2_3_4
      emitGetPtr("z_PTR2", lhsVarName, node.indexExpr);
      compileCompoundExpression(rhs, lhs.type, lhs.name);
    } else throw new MinCompileError(`Unimplemented assignment rhs int* = ${rhs.$type}`, rhs);
  } else {
    // lhs is not a pointer, so rhs must be a single expression
    if (rhs.exprs.length != 1) throw new MinCompileError(`Cannot assign compound expression to non-pointer variable`, rhs);
    compileExpression(rhs.exprs[0]);
    emitCopyZIntoVar("z_A", lhs.name, node.indexExpr);
  }
}

export function compileVariableCalcAssignment(node: VariableCalcAssignment) {
  if (node.value == 0) return; // x += 0
  const varName = node.varName.$refText;
  const { symbolInfo: lhs } = getSymbol(varName);

  emitCopyVarIntoZ("z_A", varName, node.indexExpr); // z_PTR = &varName

  if (node.op === "+=") {
    if (lhs.type === "int") {
      if (node.value <= 0xff) {
        out(`LDI ${hexByte(node.value)} ADV z_A`, `${node.varName} += ${node.value}`);
      } else {
        out(`LDI ${hexByte(node.value & 0xff)} ADV z_A LDI ${hexByte(node.value >> 8)} AD.Z z_A+1`, `${node.varName} += ${node.value}`);
      }
      cached.z_A = "";
      emitCopyZIntoVar("z_A", varName);
    } else {
      out(`LDI ${hexByte(node.value)} AD.T z_PTR `, `${node.varName} += ${node.value}`);
    }
  } else {
    if (lhs.type === "int") {
      throw new MinCompileError(`-= on integer type not supported yet`, node);
    } else {
      out(`LDI ${hexByte(node.value)} SU.T z_PTR `, `${node.varName} -= ${node.value}`);
    }
  }
}

export function compileVariableReference(e: VariableReference) {
  const varName = e.varName.$refText;
  const v = getSymbol(varName);

  if (isArrayExpression(e)) {
    // eg a[0|4]  a[|4]  a[x|y]
    if (e.isAddress) throw new MinCompileError(`Cannot take address of array slice`, e);
    emitGetArrayPtr("z_A", e); // z_A = &a[slicestart], z_CNT = num items, z_B = num bytes
  } else {
    // eg a or a[5] or &a
    if (e.isAddress) {
      emitGetPtr("z_A", varName, e.index?.startExpr);
    } else {
      emitCopyVarIntoZ("z_A", varName, e.index?.startExpr);
    }
  }
}
