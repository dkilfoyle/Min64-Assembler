import type { AstNode } from "langium";
import { MinCompileError, hexByte, hexWord } from "../utils";
import type { Expression, VariableAssignment, VariableCalcAssignment, VariableDeclaration, VariableReference } from "../../ls/generated/ast";
import { cached, isCachedPtr, out } from "./compiler";
import { compileExpression, constEval } from "./expressions";

export interface IVariableSymbol {
  name: string;
  kind: "param" | "local";
  type: "int" | "char";
  count: number;
  address: number; // offset in the case of location=stack
  location: "stack" | "zeroPage" | "global" | "heap";
}

export interface IStackFrame {
  name: string;
  kind: "function" | "block" | "global";
  variables: Map<string, IVariableSymbol>;
  frameSize: number;
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
    if (i < frameStack.length - 1 && i > 0) fpOffset += frameStack[i].frameSize;
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

function emitGetPtr(varName: string, varIndex?: Expression, preserveZA?: boolean) {
  const { fpOffset, fpName, symbolInfo: varInfo } = getSymbol(varName);
  const cacheName = fpName + (varIndex ? `[${varIndex.$cstNode?.text}]` : "");
  if (cached.z_PTR == cacheName) return;
  else cached.z_PTR = cacheName;

  switch (varInfo.location) {
    case "stack":
      const x = "MVV z_FP,z_PTR";
      if (fpOffset < 0) {
        // z_PTR = z_FP - abs(fpOffset)
        out(`${x} SIV ${Math.abs(fpOffset)},z_PTR`, `z_PTR = &${varName}`);
      } else if (fpOffset == 0) {
        out(`${x}`, `z_PTR = &${varName}`);
      } else {
        // z_PTR = z_FP + fpOffset
        out(`${x} AIV ${fpOffset},z_PTR`, `z_PTR = &${varName}`);
      }
      break;
    case "zeroPage":
      out(`MIZ ${hexByte(varInfo.address)},z_PTR`, `z_PTR = &${varName}`);
      break;
    case "global":
      out(`MIZ ${hexWord(varInfo.address)},z_PTR`, `z_PTR = &${varName}`);
      break;
    case "heap":
      throw new MinCompileError(`Cannot get pointer to heap variable ${varName}`, {} as AstNode);
  }

  if (varIndex) {
    if (preserveZA) out(`MVV z_A,z_B`, "save z_A to z_B");
    compileExpression(varIndex);
    if (varInfo.type == "int") {
      out(`LLV z_A`, `z_A = array index ${varIndex.$cstNode?.text} * size(int)`);
    }
    out(`SVV z_A,z_PTR`, `z_PTR = &${varName}[${varIndex.$cstNode?.text}]`);
    if (preserveZA) out(`MVV z_B,z_A`, "restore z_A");
  }
}

export function emitCachedZA(instr: string, comment: string, value: string) {
  if (cached.z_A == value) return;
  out(instr, comment);
  cached.z_A = value;
}

export function emitCopyZIntoVar(sourceZ: string, varName: string, varIndex?: Expression) {
  if (sourceZ !== "z_A") throw new MinCompileError(`Unsupported sourceZ ${sourceZ} for copying into variable ${varName}`, {} as AstNode);
  const { fpName, fpOffset, symbolInfo: v } = getSymbol(varName);
  if (v.location === "stack") {
    // copying from z_A on to the stack
    if (v.address > 255) throw new MinCompileError(`Maximum frame size is 255, got ${v.address} for ${varName}`, {} as AstNode);
    emitGetPtr(varName, varIndex, true);
    if (v.type == "int") {
      out(`JPS __sdZA`, `${fpName}:int = z_A(${cached.z_A})`);
    } else {
      out(`MZT z_A+0,z_PTR`, `${fpName}:char = z_A(${cached.z_A})`);
    }
    return;
  } else if (v.location === "zeroPage") {
    // copying from z_A on to zeroPage
    if (varIndex) {
      emitGetPtr(varName, varIndex, true);
      out(`JPS __sdZA`, `${fpName}:int[${varIndex.$cstNode?.text}] = z_A(${cached.z_A})`);
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
  throw new MinCompileError(`Unsupported location for variable ${varName}`, {} as AstNode);
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
        emitGetPtr(varName, varIndex, false);
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
        emitGetPtr(varName, varIndex, false); // z_PTR = &varName
        out(`MTZ z_PTR,${targetLSB} JPS sign_ext`, `${varName} from stack -> ${targetAddr}`);
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

export function compileVariableReference(e: VariableReference) {
  const varName = e.varName.$refText;
  if (e.index && e.index.startExpr) {
    compileExpression(e.index.startExpr); // z_A = index
    out(`MVV z_A,z_IDX`, `z_IDX = index for ${varName}`);
  }
  emitCopyVarIntoZ("z_A", varName, e.index?.startExpr);
}

export function compileVariableDeclaration(node: VariableDeclaration) {
  const frame = currentFrame(node);
  const varName = node.name;

  if (node.atExpr) {
    const address = constEval(node.atExpr);
    const symbolInfo: IVariableSymbol = {
      name: node.name,
      kind: "local",
      type: node.type,
      count: 1, // Assuming single variable for now; extend for arrays if needed
      location: address <= 0xff ? "zeroPage" : "global",
      address: address,
    };
    frame.variables.set(varName, symbolInfo);
  } else {
    const symbolInfo: IVariableSymbol = {
      name: node.name,
      kind: "local",
      type: node.type,
      count: 1, // Assuming single variable for now; extend for arrays if needed
      location: "stack",
      address: frame.frameSize,
    };
    frame.variables.set(varName, symbolInfo);
    frame.frameSize += node.type == "int" ? 2 : 1; // Assuming each variable takes 1 unit of frame size
  }
  if (node.assignExpr) {
    compileExpression(node.assignExpr.exprs[0]); // z_A = result of expression
    emitCopyZIntoVar("z_A", varName);
  }
}

export function compileVariableAssignment(node: VariableAssignment) {
  const varName = node.varName.$refText;
  compileExpression(node.assignExpr.exprs[0]); // z_A = result of expression
  emitCopyZIntoVar("z_A", varName, node.indexExpr);
}

export function compileVariableCalcAssignment(node: VariableCalcAssignment) {
  if (node.value == 0) return;
  const frame = currentFrame(node);
  const varName = node.varName.$refText;
  const symbolInfo = frame.variables.get(varName);
  if (!symbolInfo) {
    throw new MinCompileError(`Variable ${varName} not found in current scope`, node);
  }

  emitCopyVarIntoZ("z_A", varName, node.indexExpr); // z_PTR = &varName

  if (node.op === "+=") {
    if (symbolInfo.type === "int") {
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
    if (symbolInfo.type === "int") {
      out(`; how to do this? check min.asm`);
    } else {
      out(`LDI ${hexByte(node.value)} SU.T z_PTR `, `${node.varName} += ${node.value}`);
    }
  }
}
