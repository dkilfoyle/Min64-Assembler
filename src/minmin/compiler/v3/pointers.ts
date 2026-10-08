import { MinCompileError, hexByte, hexWord } from "../utils";
import { isNumberLiteral, type Expression, type VariableReference } from "../../ls/generated/ast";
import { out } from "./compiler";
import { compileExpression } from "./expressions";
import { getSymbol } from "./variables";

function emitDereferencePointer(z_PTR: string) {
  // convert z_PTR (pointer to pointer) into the actual heap address it points to
  out(`MTZ ${z_PTR},z_B+1 DEV ${z_PTR}`, `Deference z_PTR to z_B`);
  out(`MTZ ${z_PTR},z_B+0`, `z_B = **${z_PTR} (pointer to heap location)`);
  out(`MVV z_B,${z_PTR}`, `${z_PTR} = heap address of pointer`);
}

export function emitGetPtr(z_PTR: string, varName: string, varIndex?: Expression | number, preserveZA?: boolean) {
  const { fpOffset, fpName, symbolInfo: varInfo } = getSymbol(varName);
  const cacheName = fpName + (varIndex ? `[${typeof varIndex === "number" ? varIndex : varIndex.$cstNode?.text}]` : "");
  // TODO: Cache z_PTR to avoid redundant calculations
  // if (cached.z_PTR == cacheName) return;
  // else cached.z_PTR = cacheName;

  switch (varInfo.location) {
    case "stack":
      const x = `MVV z_FP,${z_PTR}`;
      if (fpOffset < 0) {
        // targetPtr = z_FP - abs(fpOffset)
        out(`${x} SIV ${Math.abs(fpOffset)},${z_PTR}`, `${z_PTR} = &${varName}`);
      } else if (fpOffset == 0) {
        out(`${x}`, `${z_PTR} = &${varName}`);
      } else {
        // targetPtr = z_FP + fpOffset
        out(`${x} AIV ${fpOffset},${z_PTR}`, `${z_PTR} = &${varName}`);
      }
      break;
    case "zeroPage":
      out(`MIV ${hexWord(varInfo.address)},${z_PTR}`, `${z_PTR} = &${varName}`);
      break;
    case "global":
      out(`MIV ${hexWord(varInfo.address)},${z_PTR}`, `${z_PTR} = &${varName}`);
      break;
    case "heap":
      throw new MinCompileError(`Cannot get pointer to heap variable ${varName}`);
  }

  if (varInfo.type.endsWith("*") && varIndex && varInfo.location != "global") {
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
      } else if (offset < 256) out(`AIV ${hexByte(offset)},${z_PTR}`, `${z_PTR} = &${varName}[${index}]`);
      else out(`MIV ${hexWord(offset)},z_B AVV z_B,${z_PTR}`, `${z_PTR} = &${varName}[${index}]`);
    } else {
      if (preserveZA) out(`MVV z_A,z_B`, "save z_A to z_B");
      compileExpression(varIndex);
      if (varInfo.type == "int" || varInfo.type == "int*") {
        out(`LLV z_A`, `z_A = array index ${varIndex.$cstNode?.text} * size(int)`);
      }
      // arrays are indexed upwards in memory regardless of location
      out(`AVV z_A,${z_PTR}`, `${z_PTR} = &${varName}[${varIndex.$cstNode?.text}]`);
      if (preserveZA) out(`MVV z_B,z_A`, "restore z_A");
    }
  }
}

/**
 * Emits code to set ptrReg to &arr[start], z_CNT to num of items in slice, z_A to num of bytes in slice
 * @param ptrReg The register to store the pointer.
 * @param varRef The variable reference representing the slice.
 * @remarks
 * Assumes the variable referenced by `varRef` is a pointer type (e.g., `int*` or `char*`).
 */
export function emitGetArrayPtr(ptrReg: string, varRef: VariableReference) {
  const varName = varRef.varName.$refText;
  const { type: varType, count } = getSymbol(varName).symbolInfo;

  if (!varRef.index) {
    // a without an index, just the base pointer
    if (count === undefined) throw new MinCompileError(`Array size is not known at compile time`, varRef);
    emitGetPtr(ptrReg, varName);
    emitDereferencePointer(ptrReg);
    if (varType == "int*") {
      out(`MIV ${hexWord(count)},z_CNT MIV ${hexWord(count * 2)},z_A`, `z_CNT = num items, z_A = num of bytes in full array`);
    } else if (varType == "char*") {
      out(`MIV ${hexWord(count)},z_CNT MIV ${hexWord(count)},z_A`, `z_CNT = num items, z_A = num of bytes in full array`);
    } else throw new MinCompileError(`Unsupported variable type for slice`, varRef);
    return;
  }

  if (!varRef.index.endExpr) throw new MinCompileError(`Slice end expression is missing`, varRef);
  if (!varType.endsWith("*")) throw new MinCompileError(`Variable type ${varType} is not a pointer`, varRef);

  compileExpression(varRef.index.endExpr); // z_A = endExpr
  out(`INV z_A`, `Add 1 for inclusive slice ends`);
  out(`MVV z_A,z_CNT`, `z_CNT = endExpr - startExpr + 1`);
  if (varRef.index.startExpr) {
    // adjust z_CNT by subtracting the start index
    compileExpression(varRef.index.startExpr); // z_A = startExpr
    out(`SVV z_A,z_CNT`, `z_CNT = number of items in slice`);
  }
  emitGetPtr(ptrReg, varName);
  if (varType == "int*") out(`MVV z_CNT,z_A LLV z_A`, `z_A = number of bytes in slice`);
  else if (varType == "char*") {
    out(`MVV z_CNT,z_A`, `z_A = number of bytes in slice`);
  } else throw new MinCompileError(`Unsupported variable type for slice`, varRef);
}
