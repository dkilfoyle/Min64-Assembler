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
import { cached } from "./cache";

export function emitDereferencePointer(z_PTR: string) {
  // convert z_PTR (pointer to pointer) into the actual heap address it points to
  out(`MTZ ${z_PTR},z_TMP1+1 DEV ${z_PTR}`, `Deference z_PTR to z_TMP1`);
  out(
    `MTZ ${z_PTR},z_TMP1+0`,
    `z_TMP1 = **${z_PTR} (pointer to heap location)`,
  );
  out(`MVV z_TMP1,${z_PTR}`, `${z_PTR} = heap address of pointer`);
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
  if (varInfo.address == 0) {
    out(`${x}`, `${z_PTR} = &${varInfo.name}`);
  } else if (varInfo.kind == "local") {
    // targetPtr = z_FP - abs(fpOffset)
    out(`${x} SIV ${varInfo.address},${z_PTR}`, `${z_PTR} = &${varInfo.name}`);
  } else if (varInfo.kind == "param") {
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

  cached.unsetZA();
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
      } else if (offset < 256) {
        out(
          `AIV ${hexByte(offset)},${z_PTR}`,
          `${z_PTR} = &${varName}[${index}]`,
        );
      } else {
        out(
          `MIV ${hexWord(offset)},z_TMP1 AVV z_TMP1,${z_PTR}`,
          `${z_PTR} = &${varName}[${index}]`,
        );
      }
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

const isConst = (e?: Expression) => !e || isNumberLiteral(e);
const constVal = (e?: Expression) => (e ? ((e as any).value as number) : 0);

export function emitGetArrayPtr(ptrReg: string, varRef: VariableReference) {
  const varName = varRef.varName.$refText;
  const { varInfo } = frameStack.getVariable(varName);
  const elSize = varInfo.type == "int*" ? 2 : varInfo.type == "char*" ? 1 : 0;
  if (!elSize)
    throw new MinCompileError(`Unsupported variable type for slice`, varRef);

  // whole array: base pointer + known length
  if (!varRef.index) {
    const cnt = varInfo.count ?? 1;
    emitGetPtr(ptrReg, varName);
    emitDereferencePointer(ptrReg);
    out(
      `MIV ${hexWord(cnt)},z_CNT MIV ${hexWord(cnt * elSize)},z_B`,
      `z_CNT=items, z_B=bytes`,
    );
    return;
  }

  const { startExpr, endExpr } = varRef.index;
  if (!endExpr)
    throw new MinCompileError(`Slice end expression is missing`, varRef);

  // 1. count and byte size
  if (isConst(startExpr) && isNumberLiteral(endExpr)) {
    const cnt = endExpr.value - constVal(startExpr);
    out(
      `MIV ${hexWord(cnt)},z_CNT MIV ${hexWord(cnt * elSize)},z_B`,
      `z_CNT=items, z_B=bytes`,
    );
  } else {
    compileExpression(endExpr);
    if (startExpr && !isConst(startExpr)) {
      out(`MVV z_A,z_CNT`, `z_CNT = end`);
      compileExpression(startExpr); // evaluated once more only if non-constant
      out(`SVV z_A,z_CNT`, `z_CNT = end - start`);
    } else {
      out(`MVV z_A,z_CNT`, `z_CNT = end`);
      if (startExpr)
        out(`SIV ${hexByte(constVal(startExpr))},z_CNT`, `z_CNT = end - start`);
    }
    out(
      `MVV z_CNT,z_B${elSize == 2 ? " LLV z_B" : ""}`,
      `z_B = bytes in slice`,
    );
  }

  // 2. pointer to &arr[start] directly in ptrReg (emitGetPtr already derefs and scales the index)
  emitGetPtr(ptrReg, varName, startExpr, false);
  if (!startExpr) emitDereferencePointer(ptrReg);
}
