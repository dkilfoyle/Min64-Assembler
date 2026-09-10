import type { AstNode } from "langium";
import { CompileError, hexByte, hexWord } from "../utils";
import type {
  VariableAssignment,
  VariableCalcAssignment,
  VariableDeclaration,
  VariableReference,
} from "../../ls/generated/ast";
import { cached, isCachedPtr, out, outi } from "./compiler";
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
  if (!frame)
    throw new CompileError("No current stack frame", node || ({} as AstNode));
  return frame;
}

export function getSymbol(
  name: string,
  node?: AstNode,
): { fpOffset: number; fpName: string; symbolInfo: IVariableSymbol } {
  let fpOffset = 0;
  let fpName = name;

  for (let i = frameStack.length - 1; i >= 0; i--) {
    const frame = frameStack[i];
    fpName = `${frame.name}.${fpName}`;
    const symbolInfo = frame.variables.get(name);
    if (symbolInfo)
      return { fpOffset: fpOffset - symbolInfo.address, fpName, symbolInfo };
    fpOffset += frame.frameSize;
    if (frame.kind == "function") i = 0; // jump to global
  }

  throw new CompileError(
    `Symbol ${name} not found in frameStack`,
    node || ({} as AstNode),
  );
}

/** z_PTR = &VarOnStack */
export function emitGetPtr(varName: string, varIndex?: string) {
  const { fpOffset, fpName, symbolInfo } = getSymbol(varName);

  if (symbolInfo.location === "stack") {
    if (isCachedPtr(varName + (varIndex || ""))) return;
    if (fpOffset < 0) {
      outi(
        `MVV z_FP,z_PTR SIV ${Math.abs(fpOffset)},z_PTR`,
        `z_PTR = &${varName}`,
      );
    } else if (fpOffset > 0) {
      outi(`MVV z_FP,z_PTR AIV ${fpOffset},z_PTR`, `z_PTR = &${varName}`);
    } else outi(`MVV z_FP,z_PTR`, `z_PTR = &${varName}`);
  } else if (symbolInfo.location === "zeroPage") {
    throw new CompileError(
      `Symbol ${varName} is zeroPage, not in stack`,
      {} as AstNode,
    );
  } else if (symbolInfo.location === "global") {
    outi(`MIZ ${hexWord(symbolInfo.address)},z_PTR`, `z_PTR = &${varName}`);
  } else if (symbolInfo.location === "heap") {
    throw new CompileError(
      `Symbol ${varName} is heap, not in stack`,
      {} as AstNode,
    );
  }
}

export function emitCopyZIntoVar(
  sourceZ: string,
  varName: string,
  varIndex?: string,
) {
  const { fpName, fpOffset, symbolInfo: v } = getSymbol(varName);
  if (v.location === "stack") {
    if (v.address > 255)
      throw new CompileError(
        `Maximum frame size is 255, got ${v.address} for ${varName}`,
        {} as AstNode,
      );
    if (sourceZ == "z_A") {
      emitGetPtr(varName, varIndex);
      outi(`JPS __sdZA`, `z_A -> ${fpName}`);
    } else {
      throw new CompileError(
        `Unsupported sourceZ ${sourceZ} for copying into stack variable ${varName}`,
        {} as AstNode,
      );
    }

    return;
  } else if (v.location === "zeroPage") {
    outi(
      `MVV ${sourceZ},${hexByte(v.address)}`,
      `${varName} from ${sourceZ} -> zeroPage`,
    );
    return;
  } else if (v.location === "global") {
    outi(
      `MWV ${sourceZ},${hexWord(v.address)}`,
      `${varName} from ${sourceZ} -> global`,
    );
    return;
  }
  throw new CompileError(
    `Unsupported location for variable ${varName}`,
    {} as AstNode,
  );
}

/** z_PTR = &VarOnStack z_A/B = **z_PTR */
export function emitCopyVarIntoZ(varName: string, targetAddr: number | string) {
  const { fpName, fpOffset, symbolInfo: v } = getSymbol(varName);

  // ensure valid targetAddr which must be in zero page
  if (typeof targetAddr === "number" && targetAddr > 0xff)
    throw new CompileError(
      `Target address ${targetAddr} is not zero-page`,
      {} as AstNode,
    );
  if (
    typeof targetAddr === "string" &&
    ["z_A", "z_B", "z_C", "z_D"].includes(targetAddr) == false
  )
    throw new CompileError(
      `Target address ${targetAddr} is not a valid z target`,
      {} as AstNode,
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

  if (v.type === "int") {
    switch (v.location) {
      case "stack":
        emitGetPtr(varName);
        switch (targetAddr) {
          case "z_A":
            outi(`JPS __ldZA`, `${varName} -> z_A`);
            break;
          case "z_B":
            outi(`LDI ${v.address} PHS JPS __ldZB PLS`, `z_B=${varName}`);
            break;
          default:
            throw new CompileError(
              `Unsupported target address ${targetAddr}`,
              {} as AstNode,
            );
        }
        return;
      case "zeroPage":
        outi(
          `MVV ${hexByte(v.address)},${targetLSB}`,
          `${varName} from zeroPage -> ${targetAddr}`,
        );
        return;
      case "global":
        outi(
          `MWV ${hexWord(v.address)},${targetLSB}`,
          `${varName} from global -> ${targetAddr}`,
        );
        return;
    }
  } else {
    switch (v.location) {
      case "stack":
        emitGetPtr(varName); // z_PTR = &varName
        outi(
          `MTZ z_PTR,${targetLSB} JPS sign_ext`,
          `${varName} from stack -> ${targetAddr}`,
        );
        return;
      case "zeroPage":
        outi(
          `MZZ ${hexByte(v.address)},${targetLSB} JPS __signext`,
          `${varName} from zeroPage -> ${targetAddr}`,
        );
        return;
      case "global":
        outi(
          `MBZ ${hexWord(v.address)},${targetLSB} JPS __signext`,
          `${varName} from global -> ${targetAddr}`,
        );
        return;
    }
  }
}

export function compileVariableReference(e: VariableReference) {
  const varName = e.varName.$refText;
  emitCopyVarIntoZ(varName, "z_A");
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
  const frame = currentFrame(node);
  const varName = node.varName.$refText;
  const symbolInfo = frame.variables.get(varName);
  if (!symbolInfo) {
    throw new CompileError(
      `Variable ${varName} not found in current scope`,
      node,
    );
  }

  if (node.indexExpr) {
    compileExpression(node.indexExpr); // z_PTR = index
    outi(`MVV z_A,z_PTR`, "z_PTR = index");
  }

  compileExpression(node.assignExpr.exprs[0]); // z_A = result of expression
  emitCopyZIntoVar("z_A", varName, node.indexExpr?.$cstNode?.text);
}

export function compileVariableCalcAssignment(node: VariableCalcAssignment) {
  if (node.value == 0) return;
  const frame = currentFrame(node);
  const varName = node.varName.$refText;
  const symbolInfo = frame.variables.get(varName);
  if (!symbolInfo) {
    throw new CompileError(
      `Variable ${varName} not found in current scope`,
      node,
    );
  }

  emitCopyVarIntoZ(varName, "z_A"); // z_PTR = &varName

  if (node.op === "+=") {
    if (symbolInfo.type === "int") {
      if (node.value <= 0xff) {
        outi(
          `LDI ${hexByte(node.value)} ADV z_A`,
          `${node.varName} += ${node.value}`,
        );
      } else {
        outi(
          `LDI ${hexByte(node.value & 0xff)} ADV z_A LDI ${hexByte(node.value >> 8)} AD.Z z_A+1`,
          `${node.varName} += ${node.value}`,
        );
      }
      cached.z_A = "";
      emitCopyZIntoVar("z_A", varName);
    } else {
      outi(
        `LDI ${hexByte(node.value)} AD.T z_PTR `,
        `${node.varName} += ${node.value}`,
      );
    }
  } else {
    if (symbolInfo.type === "int") {
      outi(`; how to do this? check min.asm`);
    } else {
      outi(
        `LDI ${hexByte(node.value)} SU.T z_PTR `,
        `${node.varName} += ${node.value}`,
      );
    }
  }
}
