import type { AstNode } from "langium";
import { MinCompileError, hexByte, hexWord } from "../utils";
import {
  isVariableReference,
  type Expression,
  type VariableAssignment,
  type VariableCalcAssignment,
  type VariableDeclaration,
  type VariableReference,
} from "../../ls/generated/ast";
import { cached, emitRuntimeCall, out, runtimeUsed } from "./compiler";
import {
  compileCompoundExpression,
  compileExpression,
  constEval,
  isArrayExpression,
} from "./expressions";
import { emitGetPtr, emitGetArrayPtr } from "./pointers";
import { emitRTPushZ, frameStack } from "./stack";

export type IExpressionType = "int" | "char" | "int*" | "char*";

export interface IVariable {
  name: string;
  kind: "param" | "local";
  type: IExpressionType;
  location: "stack" | "globalStack" | "zeroPage" | "absolute";
  // global is for variables stored in the global stack frame and address is the absolute address in memory
  address: number; // for stack var this is the offset from the frame pointer
  count?: number; // for array types, the number of elements
  // offset (+ve to lower addresses) in the case of location=stack
  // 0x10000 if location=heap (to throw an error if address is used)
}

export function emitCachedZA(instr: string, comment: string, value: string) {
  if (cached.z_A.id == value) return;
  out(instr, comment);
  cached.z_A.id = value;
}

export function emitCopyZIntoVar(
  sourceZ: string,
  varName: string,
  varIndex?: Expression | number,
) {
  if (sourceZ !== "z_A")
    throw new MinCompileError(
      `Unsupported sourceZ ${sourceZ} for copying into variable ${varName}`,
    );
  const { frame, varInfo } = frameStack.getVariable(varName);

  switch (varInfo.location) {
    case "stack":
      // copying from z_A on to the stack
      if (varInfo.address > 255)
        throw new MinCompileError(
          `Maximum frame size is 255, got ${varInfo.address} for ${varName}`,
        );
      emitGetPtr("z_PTR", varName, varIndex, true);
      if (varInfo.type == "int") {
        emitRuntimeCall(
          `sdZA`,
          `${frame.name}.${varInfo.name}:int = z_A(${cached.z_A})`,
        );
      } else {
        out(
          `MZT z_A+0,z_PTR`,
          `${frame.name}.${varInfo.name}:char = z_A(${cached.z_A})`,
        );
      }
      return;
    case "zeroPage":
      // copying from z_A on to zeroPage
      if (varIndex) {
        emitGetPtr("z_PTR", varName, varIndex, true);
        emitRuntimeCall(
          `copyZA`,
          `${frame.name}.${varInfo.name}:int[${typeof varIndex === "number" ? varIndex : varIndex.$cstNode?.text}] = z_A(${cached.z_A})`,
        );
      } else {
        if (varInfo.type == "int") {
          out(
            `MVV z_A,${hexByte(varInfo.address)}`,
            `${frame.name}.${varInfo.name}:int = z_A ()`,
          );
        } else {
          out(
            `MZZ z_A+0,${hexByte(varInfo.address)}`,
            `LSB(z_A) -> ${frame.name}.${varInfo.name}`,
          );
        }
      }
      return;
    case "absolute":
    case "globalStack":
      out(
        `MWV ${sourceZ},${hexWord(varInfo.address)}`,
        `${frame.name}.${varInfo.name} from ${sourceZ} -> global`,
      );
      return;
    default:
      throw new MinCompileError(`Unsupported location for variable ${varName}`);
  }
}

/** z_PTR = &VarOnStack z_A/B = **z_PTR */
export function emitCopyVarIntoZ(
  targetAddr: number | string,
  varName: string,
  varIndex?: Expression,
) {
  const { frame, varInfo } = frameStack.getVariable(varName);

  // ensure valid targetAddr which must be in zero page
  if (typeof targetAddr === "number" && targetAddr > 0xff)
    throw new MinCompileError(`Target address ${targetAddr} is not zero-page`);
  if (
    typeof targetAddr === "string" &&
    ["z_A", "z_B", "z_C", "z_D"].includes(targetAddr) == false
  )
    throw new MinCompileError(
      `Target address ${targetAddr} is not a valid z target`,
    );

  // calculate target LSB and MSB addresses
  const targetLSB =
    typeof targetAddr === "number"
      ? hexByte((targetAddr + 0) & 0xff)
      : `${targetAddr}+0`;
  const targetMSB =
    typeof targetAddr === "number"
      ? hexByte((targetAddr + 1) & 0xff)
      : `${targetAddr}+1`;

  if (varInfo.type === "int") {
    switch (varInfo.location) {
      case "stack":
        emitGetPtr("z_PTR", varName, varIndex, false);
        switch (targetAddr) {
          case "z_A":
            out(`JPS __ldZA`, `${varName} -> z_A`);
            break;
          case "z_B":
            out(
              `LDI ${varInfo.address} PHS JPS __ldZB PLS`,
              `z_B=${varInfo.name}`,
            );
            break;
          default:
            throw new MinCompileError(
              `Unsupported target address ${targetAddr}`,
            );
        }
        return;
      case "zeroPage":
        out(
          `MVV ${hexByte(varInfo.address)},${targetLSB}`,
          `${frame.name}.${varInfo.name} from zeroPage -> ${targetAddr}`,
        );
        return;
      case "globalStack":
      case "absolute":
        out(
          `MWV ${hexWord(varInfo.address)},${targetLSB}`,
          `${frame.name}.${varInfo.name} from global -> ${targetAddr}`,
        );
        return;
    }
  } else {
    switch (varInfo.location) {
      case "stack":
        emitGetPtr("z_PTR", varName, varIndex, false); // z_PTR = &varName
        out(
          `MTZ z_PTR,${targetLSB} JPS __signext`,
          `${frame.name}.${varInfo.name} from stack -> ${targetAddr}`,
        );
        return;
      case "zeroPage":
        out(
          `MZZ ${hexByte(varInfo.address)},${targetLSB} JPS __signext`,
          `${frame.name}.${varInfo.name} from zeroPage -> ${targetAddr}`,
        );
        return;
      case "globalStack":
      case "absolute":
        out(
          `MBZ ${hexWord(varInfo.address)},${targetLSB} JPS __signext`,
          `${frame.name}.${varInfo.name} from global -> ${targetAddr}`,
        );
        return;
    }
  }
}

const getSelfSizeRangeExpr = (node: VariableDeclaration) => {
  if (!node.assignExpr) return undefined;
  if (node.assignExpr.exprs.length !== 1) return undefined;
  const expr = node.assignExpr.exprs[0];
  if (
    isVariableReference(expr) &&
    expr.varName.$refText === node.name &&
    !!expr.index
  )
    return expr.index;
  return undefined;
};

export function compileVariableDeclaration(node: VariableDeclaration) {
  const arraySizeDecl = getSelfSizeRangeExpr(node);
  const isArrayAssignDecl =
    node.assignExpr != undefined && node.assignExpr.exprs.length > 1;
  const isArray = arraySizeDecl != undefined || isArrayAssignDecl;
  const frame = frameStack.current(node);

  const varInfo = frameStack.addLocalVariable(node, isArray);

  // z_SP should be ready to receive the variable's value

  if (node.assignExpr) {
    if (arraySizeDecl) {
      // int a = a[0|n]
      if (arraySizeDecl.startExpr && constEval(arraySizeDecl.startExpr) !== 0)
        throw new MinCompileError(
          `Start index must be 0 or undefined`,
          arraySizeDecl.startExpr,
        );
      if (!arraySizeDecl.endExpr)
        throw new MinCompileError(`End index must be specified`, arraySizeDecl);

      emitRTPushZ("z_HP");

      try {
        varInfo.count = constEval(arraySizeDecl.endExpr) + 1; // +1 as array slice is inclusive of start and end
        if (varInfo.type == "int*") {
          out(
            `MIV ${hexWord(varInfo.count * 2)},z_A AVV z_A,z_HP`,
            "Advance z_HP by size of int array",
          );
        } else {
          out(
            `MIV ${hexWord(varInfo.count)},z_A AVV z_A,z_HP`,
            "Advance z_HP by size of char array",
          );
        }
      } catch {
        throw new MinCompileError(
          `Array size must be a constant`,
          arraySizeDecl.endExpr,
        );
        // TODO: implement handling for runtime array sizes
        // could store the array size at runtime, e.g., in the first 2 bytes of the array
        // compileExpression(arraySizeDecl.endExpr); // z_A = length of array
        // array size will be z_A + 1 [0|x] or [|x] is length x+1
        // if (symbolInfo.type == "int*") {
        //   out(`LLV z_A AVV z_A,z_HP`, "Advance z_HP by size of int array");
        // } else {
        //   out(`AVV z_A,z_HP`, "Advance z_HP by size of char array");
        // }
      }
    } else if (isArrayAssignDecl) {
      // int a = 1_2_3
      emitRTPushZ("z_HP");
      out(`MVV z_HP,z_PTR2`);
      compileCompoundExpression(node.assignExpr, varInfo.type, varInfo.name);
      out(`MVV z_PTR2,z_HP`, "Update z_HP from z_PTR2");
    } else {
      // not an array
      compileExpression(node.assignExpr.exprs[0]); // z_A = result of expression
      emitRTPushZ("z_A");
    }
  } else {
    // variable has no initializer, so we need to allocate space for it
    varInfo.type == "char"
      ? out(`DEV z_SP`, `Allocate space for uninitialized char`)
      : out(`DEV z_SP DEV z_SP`, `Allocate space for uninitialized int`);
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

  if (lhs.type == "int*") {
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
        out(`MZT z_A+1,z_PTR2`); // store the value into the pointer location
      }
    } else if (rhs.exprs.length > 1) {
      // rhs is compound expression, eg minos[5] = 1_2_3_4
      compileCompoundExpression(rhs, lhs.type, lhs.name);
    } else
      throw new MinCompileError(
        `Unimplemented assignment rhs int* = ${rhs.$type}`,
        rhs,
      );
  } else {
    // lhs is not a pointer, so rhs must be a single expression evaluating to an int
    if (rhs.exprs.length != 1)
      throw new MinCompileError(
        `Cannot assign compound expression to non-pointer variable`,
        rhs,
      );
    const exprType = compileExpression(rhs.exprs[0]);
    if (exprType != "int")
      throw new MinCompileError(
        `Type mismatch: expected int, got ${exprType}`,
        rhs,
      );
    emitCopyZIntoVar("z_A", lhs.name, node.indexExpr);
  }
}

export function compileVariableCalcAssignment(node: VariableCalcAssignment) {
  if (node.value == 0) return; // x += 0
  const varName = node.varName.$refText;
  const { varInfo: lhs } = frameStack.getVariable(varName);

  emitCopyVarIntoZ("z_A", varName, node.indexExpr); // z_PTR = &varName

  if (node.op === "+=") {
    if (lhs.type === "int") {
      if (node.value <= 0xff) {
        out(
          `LDI ${hexByte(node.value)} ADV z_A`,
          `${node.varName} += ${node.value}`,
        );
      } else {
        out(
          `LDI ${hexByte(node.value & 0xff)} ADV z_A LDI ${hexByte(node.value >> 8)} AD.Z z_A+1`,
          `${node.varName} += ${node.value}`,
        );
      }
      cached.z_A.id = "";
      emitCopyZIntoVar("z_A", varName);
    } else {
      out(
        `LDI ${hexByte(node.value)} AD.T z_PTR `,
        `${node.varName} += ${node.value}`,
      );
    }
  } else {
    if (lhs.type === "int") {
      throw new MinCompileError(`-= on integer type not supported yet`, node);
    } else {
      out(
        `LDI ${hexByte(node.value)} SU.T z_PTR `,
        `${node.varName} -= ${node.value}`,
      );
    }
  }
}

export function compileVariableReference(
  e: VariableReference,
): IExpressionType {
  const varName = e.varName.$refText;
  const { varInfo } = frameStack.getVariable(varName);

  if (isArrayExpression(e)) {
    // eg a[0|4]  a[|4]  a[x|y]
    if (e.isAddress)
      throw new MinCompileError(`Cannot take address of array slice`, e);
    emitGetArrayPtr("z_A", e); // z_A = &a[slicestart], z_CNT = num items, z_B = num bytes
    return varInfo.type; // int* or char*
  } else {
    // eg a or a[5] or &a
    if (e.isAddress) {
      emitGetPtr("z_A", varName, e.index?.startExpr);
      if (varInfo.type.endsWith("*"))
        throw new MinCompileError(`Cannot take address of pointer type`, e);
      return (varInfo.type + "*") as IExpressionType; // int* or char*
    } else {
      emitCopyVarIntoZ("z_A", varName, e.index?.startExpr);
      return varInfo.type; // int or char
    }
  }
}
