import type { AstNode } from "langium";
import type { MinCompiler } from "./compiler";
import { CompileError, hexByte, hexWord } from "../utils";
import type {
  VariableCalcAssignment,
  VariableDeclaration,
  VariableReference,
} from "../../ls/generated/ast";

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

export class VariableCompiler {
  compiler: MinCompiler;
  frameStack: IStackFrame[] = [];

  constructor(minCompiler: MinCompiler) {
    this.compiler = minCompiler;
  }

  reset() {
    this.frameStack = [];
  }

  out(instruction: string, comment?: string) {
    this.compiler.out(instruction, comment);
  }
  outi(instruction: string, comment?: string) {
    this.compiler.outi(instruction, comment);
  }

  currentFrame(node?: AstNode): IStackFrame {
    const frame = this.frameStack.at(-1);
    if (!frame)
      throw new CompileError("No current stack frame", node || ({} as AstNode));
    return frame;
  }

  getSymbol(
    name: string,
    node?: AstNode,
  ): { fpOffset: number; fpName: string; symbolInfo: IVariableSymbol } {
    let fpOffset = 0;
    let fpName = name;

    for (let i = this.frameStack.length - 1; i >= 0; i--) {
      const frame = this.frameStack[i];
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
  emitGetPtr(varName: string) {
    const { fpOffset, fpName, symbolInfo } = this.getSymbol(varName);

    if (symbolInfo.location === "stack") {
      if (this.compiler.isCachedPtr(varName)) return;
      if (fpOffset < 0) {
        this.outi(
          `MVV z_FP,z_PTR SIV ${Math.abs(fpOffset)},z_PTR`,
          `z_PTR = &${varName}`,
        );
      } else if (fpOffset > 0) {
        this.outi(
          `MVV z_FP,z_PTR AIV ${fpOffset},z_PTR`,
          `z_PTR = &${varName}`,
        );
      } else this.outi(`MVV z_FP,z_PTR`, `z_PTR = &${varName}`);
    } else if (symbolInfo.location === "zeroPage") {
      throw new CompileError(
        `Symbol ${varName} is zeroPage, not in stack`,
        {} as AstNode,
      );
    }
  }

  emitCopyZIntoVar(sourceZ: string, varName: string) {
    const { fpName, fpOffset, symbolInfo: v } = this.getSymbol(varName);
    if (v.location === "stack") {
      if (v.address > 255)
        throw new CompileError(
          `Maximum frame size is 255, got ${v.address} for ${varName}`,
          {} as AstNode,
        );
      if (sourceZ == "z_A") {
        this.emitGetPtr(varName);
        this.outi(`JPS __sdZA`, `z_A -> ${fpName}`);
      } else {
        throw new CompileError(
          `Unsupported sourceZ ${sourceZ} for copying into stack variable ${varName}`,
          {} as AstNode,
        );
      }

      return;
    } else if (v.location === "zeroPage") {
      this.outi(
        `MVV ${sourceZ},${hexByte(v.address)}`,
        `${varName} from ${sourceZ} -> zeroPage`,
      );
      return;
    } else if (v.location === "global") {
      this.outi(
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
  emitCopyVarIntoZ(varName: string, targetAddr: number | string) {
    const { fpName, fpOffset, symbolInfo: v } = this.getSymbol(varName);

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
          this.emitGetPtr(varName);
          switch (targetAddr) {
            case "z_A":
              this.outi(`JPS __ldZA`, `${varName} -> z_A`);
              break;
            case "z_B":
              this.outi(
                `LDI ${v.address} PHS JPS __ldZB PLS`,
                `z_B=${varName}`,
              );
              break;
            default:
              throw new CompileError(
                `Unsupported target address ${targetAddr}`,
                {} as AstNode,
              );
          }
          return;
        case "zeroPage":
          this.outi(
            `MVV ${hexByte(v.address)},${targetLSB}`,
            `${varName} from zeroPage -> ${targetAddr}`,
          );
          return;
        case "global":
          this.outi(
            `MWV ${hexWord(v.address)},${targetLSB}`,
            `${varName} from global -> ${targetAddr}`,
          );
          return;
      }
    } else {
      switch (v.location) {
        case "stack":
          this.emitGetPtr(varName); // z_PTR = &varName
          this.outi(
            `MTZ z_PTR,${targetLSB} JPS sign_ext`,
            `${varName} from stack -> ${targetAddr}`,
          );
          return;
        case "zeroPage":
          this.outi(
            `MZZ ${hexByte(v.address)},${targetLSB} JPS __signext`,
            `${varName} from zeroPage -> ${targetAddr}`,
          );
          return;
        case "global":
          this.outi(
            `MBZ ${hexWord(v.address)},${targetLSB} JPS __signext`,
            `${varName} from global -> ${targetAddr}`,
          );
          return;
      }
    }
  }

  compileVariableReference(e: VariableReference) {
    const varName = e.varName.$refText;
    const { symbolInfo: v } = this.getSymbol(varName, e);

    if (v.location != "stack")
      throw new CompileError(`Non stack variables not supported yet`, e);

    this.emitCopyVarIntoZ(varName, "z_A");
  }

  compileVariableDeclaration(node: VariableDeclaration) {
    const frame = this.currentFrame(node);
    const varName = node.name;

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

    if (node.assignExpr) {
      this.compiler.expressionCompiler.compileExpression(
        node.assignExpr.exprs[0],
      ); // z_A = result of expression
      this.emitCopyZIntoVar("z_A", varName);
    }
  }

  compileVariableCalcAssignment(node: VariableCalcAssignment) {
    if (node.value == 0) return;
    const frame = this.currentFrame(node);
    const varName = node.varName.$refText;
    const symbolInfo = frame.variables.get(varName);
    if (!symbolInfo) {
      throw new CompileError(
        `Variable ${varName} not found in current scope`,
        node,
      );
    }

    this.emitCopyVarIntoZ(varName, "z_A"); // z_PTR = &varName

    if (node.op === "+=") {
      if (symbolInfo.type === "int") {
        if (node.value <= 0xff) {
          this.outi(
            `LDI ${hexByte(node.value)} ADV z_A`,
            `${node.varName} += ${node.value}`,
          );
        } else {
          this.outi(
            `LDI ${hexByte(node.value & 0xff)} ADV z_A LDI ${hexByte(node.value >> 8)} AD.Z z_A+1`,
            `${node.varName} += ${node.value}`,
          );
        }
        this.compiler.cached.z_A = "";
        this.emitCopyZIntoVar("z_A", varName);
      } else {
        this.outi(
          `LDI ${hexByte(node.value)} AD.T z_PTR `,
          `${node.varName} += ${node.value}`,
        );
      }
    } else {
      if (symbolInfo.type === "int") {
        this.outi(`; how to do this? check min.asm`);
      } else {
        this.outi(
          `LDI ${hexByte(node.value)} SU.T z_PTR `,
          `${node.varName} += ${node.value}`,
        );
      }
    }
  }
}
