import { MinCompileError, hexByte, hexWord } from "../utils";
import {
  isNumberLiteral,
  type Expression,
  type VariableReference,
} from "../../ls/generated/ast";
import { out } from "./compiler";
import { compileExpression } from "./expressions";
import { frameStack } from "./stack";
import type { IVariable } from "./variables";

export function emitDereferencePointer(z_PTR: string) {
  // convert z_PTR (pointer to pointer) into the actual heap address it points to
  out(`MTZ ${z_PTR},z_B+1 DEV ${z_PTR}`, `Deference z_PTR to z_B`);
  out(`MTZ ${z_PTR},z_B+0`, `z_B = **${z_PTR} (pointer to heap location)`);
  out(`MVV z_B,${z_PTR}`, `${z_PTR} = heap address of pointer`);
}

function emitGetGlobalStackPtr(z_PTR: string, varInfo: IVariable) {
  // variables in the global stack can be accessed from absolute address 0xefff rather than offset from z_FP
  if (varInfo.address <= 0) {
    throw new MinCompileError(
      `Invalid global stack address for variable ${varInfo.name}: ${varInfo.address}`,
    );
  } else {
    // targetPtr = z_FP + fpOffset
    out(
      `MIV ${hexWord(0xefff - varInfo.address)},${z_PTR}`,
      `${z_PTR} = &${varInfo.name} (global)`,
    );
  }
}

function emitGetGlobalStackPtrPtr(z_PTR: string, varInfo: IVariable) {
  // variables in the global stack can be accessed from absolute address 0xefff rather than offset from z_FP
  if (varInfo.address <= 0) {
    throw new MinCompileError(
      `Invalid global stack address for variable ${varInfo.name}: ${varInfo.address}`,
    );
  } else {
    // targetPtr = z_FP + fpOffset
    out(
      `MBZ ${hexWord(0xefff - varInfo.address)},${z_PTR}+1`,
      `${z_PTR} = &${varInfo.name} (global)`,
    );
    out(
      `MBZ ${hexWord(0xefff - varInfo.address - 1)},${z_PTR}+0`,
      `${z_PTR} = &${varInfo.name} (global)`,
    );
  }
}

function emitGetFrameStackPtr(z_PTR: string, varInfo: IVariable) {
  const x = `MVV z_FP,${z_PTR}`;
  if (varInfo.kind == "local") {
    // targetPtr = z_FP - abs(fpOffset)
    out(`${x} SIV ${varInfo.address},${z_PTR}`, `${z_PTR} = &${varInfo.name}`);
  } else if (varInfo.address == 0) {
    out(`${x}`, `${z_PTR} = &${varInfo.name}`);
  } else {
    // targetPtr = z_FP + fpOffset
    out(`${x} AIV ${varInfo.address},${z_PTR}`, `${z_PTR} = &${varInfo.name}`);
  }
}

export function emitGetPtr(
  z_PTR: string,
  varName: string,
  varIndex?: Expression | number,
  preserveZA?: boolean,
) {
  const { frame, varInfo } = frameStack.getVariable(varName);
  const cacheName =
    frame +
    (varIndex
      ? `[${typeof varIndex === "number" ? varIndex : varIndex.$cstNode?.text}]`
      : "");
  // TODO: Cache z_PTR to avoid redundant calculations
  // if (cached.z_PTR == cacheName) return;
  // else cached.z_PTR = cacheName;

  switch (varInfo.location) {
    case "stack":
      emitGetFrameStackPtr(z_PTR, varInfo);
      break;
    case "globalStack":
      if (varInfo.type.endsWith("*")) emitGetGlobalStackPtrPtr(z_PTR, varInfo);
      else emitGetGlobalStackPtr(z_PTR, varInfo);
      break;
    case "zeroPage":
      out(`MIV ${hexWord(varInfo.address)},${z_PTR}`, `${z_PTR} = &${varName}`);
      break;
    case "absolute":
      out(`MIV ${hexWord(varInfo.address)},${z_PTR}`, `${z_PTR} = &${varName}`);
      break;
    default:
      throw new MinCompileError(
        `Cannot get pointer to heap variable ${varName}`,
      );
  }

  if (
    varInfo.type.endsWith("*") &&
    varIndex &&
    (varInfo.location == "stack" || varInfo.location == "zeroPage")
  ) {
    // don't need to dereference for globalStack or absolute locations which are already direct pointers
    // z_PTR is a pointer to the heap location
    // deference z_PTR to get the actual heap address
    emitDereferencePointer(z_PTR);
  }

  if (varIndex) {
    if (typeof varIndex === "number" || isNumberLiteral(varIndex)) {
      const index = typeof varIndex === "number" ? varIndex : varIndex.value;
      const offset = index * (varInfo.type == "int*" ? 2 : 1);
      if (offset == 0) {
        // offset is 0, no adjustment needed for targetPtr
      } else if (offset < 256)
        out(
          `AIV ${hexByte(offset)},${z_PTR}`,
          `${z_PTR} = &${varName}[${index}]`,
        );
      else
        out(
          `MIV ${hexWord(offset)},z_B AVV z_B,${z_PTR}`,
          `${z_PTR} = &${varName}[${index}]`,
        );
    } else {
      if (preserveZA) out(`MVV z_A,z_B`, "save z_A to z_B");
      compileExpression(varIndex);
      if (varInfo.type == "int" || varInfo.type == "int*") {
        out(
          `LLV z_A`,
          `z_A = array index ${varIndex.$cstNode?.text} * size(int)`,
        );
      }
      // arrays are indexed upwards in memory regardless of location
      out(
        `AVV z_A,${z_PTR}`,
        `${z_PTR} = &${varName}[${varIndex.$cstNode?.text}]`,
      );
      if (preserveZA) out(`MVV z_B,z_A`, "restore z_A");
    }
  }
}

/**
 * Emits code to set ptrReg to &arr[start], z_CNT to num of items in slice, z_B to num of bytes in slice
 * @param ptrReg The register to store the pointer.
 * @param varRef The variable reference representing the slice.
 * @remarks
 * Assumes the variable referenced by `varRef` is a pointer type (e.g., `int*` or `char*`).
 */
export function emitGetArrayPtr(ptrReg: string, varRef: VariableReference) {
  const varName = varRef.varName.$refText;
  const { varInfo } = frameStack.getVariable(varName);

  if (!varRef.index) {
    // a without an index, just the base pointer assume length 1
    let cnt = varInfo.count === undefined ? 1 : varInfo.count;

    emitGetPtr(ptrReg, varName);
    emitDereferencePointer(ptrReg);
    if (varInfo.type == "int*") {
      out(
        `MIV ${hexWord(cnt)},z_CNT MIV ${hexWord(cnt * 2)},z_B`,
        `z_CNT=num items, z_B=num of bytes in full array`,
      );
    } else if (varInfo.type == "char*") {
      out(
        `MIV ${hexWord(cnt)},z_CNT MIV ${hexWord(cnt)},z_B`,
        `z_CNT=num items, z_B=num of bytes in full array`,
      );
    } else
      throw new MinCompileError(`Unsupported variable type for slice`, varRef);
    return;
  }

  if (!varRef.index.endExpr)
    throw new MinCompileError(`Slice end expression is missing`, varRef);
  if (!varInfo.type.endsWith("*"))
    throw new MinCompileError(
      `Variable type ${varInfo.type} is not a pointer`,
      varRef,
    );

  // TODO: handle cases where startExpr or endExpr are not constant expressions
  compileExpression(varRef.index.endExpr); // z_A = endExpr
  out(`INV z_A`, `Add 1 for inclusive slice ends`); // z_A = endExpr + 1
  out(`MVV z_A,z_CNT`, `z_CNT = endExpr - startExpr + 1`);
  if (varRef.index.startExpr) {
    // adjust z_CNT by subtracting the start index
    compileExpression(varRef.index.startExpr); // z_A = startExpr
    out(`SVV z_A,z_CNT`, `z_CNT = number of items in slice`);
  }
  emitGetPtr(ptrReg, varName);
  if (varInfo.type == "int*")
    out(`MVV z_CNT,z_B LLV z_B`, `z_B = number of bytes in slice`);
  else if (varInfo.type == "char*") {
    out(`MVV z_CNT,z_B`, `z_B = number of bytes in slice`);
  } else
    throw new MinCompileError(`Unsupported variable type for slice`, varRef);
}
