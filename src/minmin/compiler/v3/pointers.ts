import { MinCompileError, hexByte, hexWord } from "../utils";
import { isNumberLiteral, type Expression, type VariableReference } from "../../ls/generated/ast";
import { out } from "./compiler";
import { compileExpression, emitHWPushZ, emitHWPopZ } from "./expressions";
import { POINTER_STACK_START, emitRTPopZ, emitRTPushZ, frameStack } from "./stack";
import type { IExpressionType, IVariable } from "./variables";
import { cached } from "./cache";

export function emitPointerOffset(z_PTR: string, offset: number, targetPtr: string) {
  if (offset & 0xffff) throw new MinCompileError(`pointer offset out of bounds`);
  out(`MIV ${hexWord(offset)},${targetPtr} AVV ${z_PTR},${targetPtr}`, `${targetPtr} = ${z_PTR}[${offset}]`);
}

export function emitDereferencePointer(z_PTR: string) {
  // convert z_PTR (pointer to pointer) into the actual heap address it points to
  out(`MTZ ${z_PTR},z_TMP1+1 DEV ${z_PTR}`, `Deference z_PTR to z_TMP1`);
  out(`MTZ ${z_PTR},z_TMP1+0`, `z_TMP1 = **${z_PTR} (pointer to heap location)`);
  out(`MVV z_TMP1,${z_PTR}`, `${z_PTR} = heap address of pointer`);
}

// function emitGetGlobalStackPtr(z_PTR: string, varInfo: IVariable) {
//   // variables in the global stack can be accessed from absolute address 0xefff rather than offset from z_FP
//   if (varInfo.address <= 0) {
//     throw new MinCompileError(`Invalid global stack address for variable ${varInfo.name}: ${varInfo.address}`);
//   } else {
//     // targetPtr = z_FP + fpOffset
//     out(`MIV ${hexWord(0xefff - varInfo.address)},${z_PTR}`, `${z_PTR} = &${varInfo.name} (global)`);
//   }
// }

// function emitGetGlobalStackPtrPtr(z_PTR: string, varInfo: IVariable) {
//   // variables in the global stack can be accessed from absolute address 0xefff rather than offset from z_FP
//   if (varInfo.address <= 0) {
//     throw new MinCompileError(`Invalid global stack address for variable ${varInfo.name}: ${varInfo.address}`);
//   } else {
//     // targetPtr = z_FP + fpOffset
//     out(`MBZ ${hexWord(0xefff - varInfo.address)},${z_PTR}+1`, `${z_PTR} = &${varInfo.name} (global)`);
//     out(`MBZ ${hexWord(0xefff - varInfo.address - 1)},${z_PTR}+0`, `${z_PTR} = &${varInfo.name} (global)`);
//   }
// }

function emitDereferenceAddressToZ(address: number, z_PTR: string, comment?: string) {
  out(`MRZ ${hexWord(address)},${z_PTR}+0`, comment || `${z_PTR}=**${hexWord(address)}`);
  out(`MRZ ${hexWord(address + 1)},${z_PTR}+1`, comment || `${z_PTR}=**${hexWord(address)}`);
}

function getIndexedOffset(varIndex?: Expression | number) {
  if (!varIndex) return 0;
  if (isNumberLiteral(varIndex)) return varIndex.value * 2; // we are indexing the pointer stack which are all 16bit pointers * (varType.includes("int") ? 2 : 1);
  if (typeof varIndex === "number") return varIndex * 2; // we are indexing the pointer stack which are all 16bit pointers
  return undefined;
}

export function emitGetPtr(z_PTR: string, varName: string, varIndex?: Expression | number, preserveZA?: boolean) {
  const { frame, varInfo, fpOffset } = frameStack.getVariable(varName);
  const cacheName = frame + (varIndex ? `[${typeof varIndex === "number" ? varIndex : varIndex.$cstNode?.text}]` : "");

  cached.unsetZA();
  // TODO: Cache z_PTR to avoid redundant calculations
  // if (cached.z_PTR == cacheName) return;
  // else cached.z_PTR = cacheName;

  const indexOffset = getIndexedOffset(varIndex);

  // first get the pointer to varName[0]
  switch (varInfo.location) {
    case "stack":
      // pointers to each variable data exist on the variable table
      // varInfo.address is offset from Z_FP2
      if (!(z_PTR == "z_PTR" || z_PTR == "z_PTR2")) {
        debugger;
        throw new MinCompileError(`emitGetPtr: Unsupported z_PTR value: ${z_PTR}`);
      }
      if (fpOffset === undefined) throw new MinCompileError(`emitGetPtr: fpOffset is undefined for variable ${varInfo.name}`);
      out(`MIV ${hexWord(fpOffset)},z_TMP1`, `sp2Offset for ${varInfo.name} = ${fpOffset}`);
      z_PTR == "z_PTR" ? out(`JPS __getVarPtr`, `z_PTR = &var[0] in stack`) : out(`JPS __getVarPtr2`, `z_PTR2 = &var[0] in stack`);
      break;
    case "globalStack":
      if (fpOffset === undefined) throw new MinCompileError(`emitGetPtr: fpOffset is undefined for variable ${varInfo.name}`);
      if (indexOffset != undefined) {
        out(
          `MWV ${hexWord(POINTER_STACK_START + fpOffset + indexOffset)},${z_PTR}`,
          `${z_PTR}=&${varName}[${indexOffset}] (${varInfo.location})`,
        );
        return;
      } else {
        out(`MWV ${hexWord(POINTER_STACK_START + fpOffset)},${z_PTR}`, `${z_PTR}=&${varName} (${varInfo.location})`);
      }
      break;
    case "zeroPage":
    case "absolute":
      if (indexOffset != undefined) {
        out(`MIV ${hexWord(varInfo.address + indexOffset)},${z_PTR}`, `${z_PTR}=&${varName}[${indexOffset}] (${varInfo.location})`);
        return;
      } else {
        out(`MIV ${hexWord(varInfo.address)},${z_PTR}`, `${z_PTR}=&${varName} (${varInfo.location})`);
      }
      break;

    default:
      throw new MinCompileError(`Cannot get pointer to heap variable ${varName}`);
  }

  if (varIndex) {
    if (typeof varIndex === "number" || isNumberLiteral(varIndex)) {
      // handle constant value index eg x[10]
      const index = typeof varIndex === "number" ? varIndex : varIndex.value;
      if (varInfo.type == "int" || varInfo.type == "char") debugger;
      const offset = index * (varInfo.type == "int*" ? 2 : 1);
      if (offset == 0) {
        // offset is 0, no adjustment needed for targetPtr
      } else if (offset < 256) {
        out(`AIV ${hexByte(offset)},${z_PTR}`, `${z_PTR} = &${varName}[${index}]`);
      } else {
        out(`MIV ${hexWord(offset)},z_TMP1 AVV z_TMP1,${z_PTR}`, `${z_PTR} = &${varName}[${index}]`);
      }
    } else {
      // handle variable value index eg x[i]
      if (preserveZA) emitHWPushZ("z_A");
      emitHWPushZ("z_PTR"); // compiling the index i will overwrite the PTR for x
      compileExpression(varIndex);
      emitHWPopZ("z_PTR");
      if (varInfo.type == "int" || varInfo.type == "int*") {
        out(`LLV z_A`, `z_A = array index ${varIndex.$cstNode?.text} * size(int)`);
      }
      // arrays are indexed upwards in memory regardless of location
      out(`AVV z_A,${z_PTR}`, `${z_PTR} = &${varName}[${varIndex.$cstNode?.text}]`);
      if (preserveZA) emitHWPopZ("z_A");
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
  if (!elSize) throw new MinCompileError(`Unsupported variable type for slice`, varRef);

  if (ptrReg == "z_A") {
    debugger;
    throw new MinCompileError(`emitGetArrayPtr: Unsupported ptrReg value: ${ptrReg}`, varRef);
  }

  // whole array: return base pointer in z_PTR
  if (!varRef.index) {
    emitGetPtr(ptrReg, varName);
    if (varInfo.count !== undefined)
      out(`MIV ${hexWord(varInfo.count)},z_CNT MIV ${hexWord(varInfo.count * elSize)},z_B`, `z_CNT=items, z_B=bytes`);
    return;
  }

  // return z_PTR = start of array slice
  const { startExpr, endExpr } = varRef.index;
  if (!endExpr) throw new MinCompileError(`Slice end expression is missing`, varRef);

  // 1. count and byte size
  if (isConst(startExpr) && isNumberLiteral(endExpr)) {
    const cnt = endExpr.value - constVal(startExpr);
    out(`MIV ${hexWord(cnt)},z_CNT MIV ${hexWord(cnt * elSize)},z_B`, `z_CNT=items, z_B=bytes`);
  } else {
    compileExpression(endExpr);
    if (startExpr && !isConst(startExpr)) {
      out(`MVV z_A,z_CNT`, `z_CNT = end`);
      compileExpression(startExpr); // evaluated once more only if non-constant
      out(`SVV z_A,z_CNT`, `z_CNT = end - start`);
    } else {
      out(`MVV z_A,z_CNT`, `z_CNT = end`);
      if (startExpr) out(`SIV ${hexByte(constVal(startExpr))},z_CNT`, `z_CNT = end - start`);
    }
    out(`MVV z_CNT,z_B${elSize == 2 ? " LLV z_B" : ""}`, `z_B = bytes in slice`);
  }

  // 2. pointer to &arr[start] directly in ptrReg (emitGetPtr already derefs and scales the index)
  emitGetPtr(ptrReg, varName, startExpr, false);
}
