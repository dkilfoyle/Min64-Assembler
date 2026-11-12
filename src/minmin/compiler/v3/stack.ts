import type { AstNode } from "langium";
import { hexWord, MinCompileError } from "../utils";
import type { IVariable } from "./variables";
import {
  isVariableDeclaration,
  VariableReference,
  type Def,
  type LocalElement,
  type NamedElement,
  type ParameterDeclaration,
  type SimpleStatement,
  type VariableDeclaration,
} from "../../ls/generated/ast";
import { constEval } from "./expressions";
import { options, out } from "./compiler";
import {
  getCompoundExpressionArraySize,
  getSliceLength,
  isArray,
  isArraySizeDecl,
} from "./arrays";

export function emitRTPushZ(sourceZ: string, type = "int") {
  if (type === "int") {
    out(`MZT ${sourceZ}+0,z_SP INV z_SP`, `push int ${sourceZ} LSB onto stack`);
    out(`MZT ${sourceZ}+1,z_SP INV z_SP`, `push int ${sourceZ} MSB onto stack`);
  } else {
    out(`MZT ${sourceZ}+0,z_SP INV z_SP`, `push char ${sourceZ} onto stack`);
  }
}

export function emitRTPopZ(destZ: string, type = "int") {
  if (type === "int") {
    out(`MTZ z_SP,${destZ}+1 DEV z_SP`, `pop int LSB from stack ${destZ}`);
    out(`MTZ z_SP,${destZ}+0 DEV z_SP`, `pop int MSB from stack ${destZ}`);
  } else {
    out(`MTZ z_SP,${destZ}+0 DEV z_SP `, `pop char from stack ${destZ}`);
  }
}

export function emitRTPullZ(destZ: string, type = "int") {
  if (type === "int") {
    out(`MTZ z_PTR,${destZ}+0 INV z_PTR`, `pull LSB from stack`);
    out(`MTZ z_PTR,${destZ}+1 DEV z_PTR`, `pull MSB from stack`);
  } else {
    out(`MTZ z_PTR,${destZ}+0 INV z_PTR`, `pull char from stack`);
  }
}

export interface IStackFrame {
  name: string;
  kind: "function" | "block" | "global";
  variables: Map<string, IVariable>;
  frameSize: number;
}

class FrameStack {
  private stack: IStackFrame[] = [];

  reset() {
    this.stack = [];
  }

  push(frame: IStackFrame) {
    this.stack.push(frame);
  }

  pop(node?: AstNode): IStackFrame {
    if (this.stack.length === 0)
      throw new MinCompileError("No stack frame to pop", node);
    return this.stack.pop()!;
  }

  current(node?: AstNode): IStackFrame {
    const frame = this.stack.at(-1);
    if (!frame) throw new MinCompileError("No current stack frame", node);
    return frame;
  }

  getStack(): IStackFrame[] {
    return this.stack;
  }

  addFrame(name: string, kind: "function" | "block" | "global") {
    const frame: IStackFrame = {
      name,
      kind,
      variables: new Map(),
      frameSize: kind == "function" ? 2 : 0, // function frames store the parents frame pointer (FP) at offset 0 and 1
    };
    this.push(frame);
    return frame;
  }

  getFunctionFrame() {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.kind === "function") return frame;
    }
    throw new MinCompileError("No function frame found");
  }

  // return the current stack pointer (SP) = offset from FP
  getSP() {
    let sp = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      const isFunctionFrame = frame.kind === "function";
      const isRootFrame = i == 0;

      sp += frame.frameSize;
      if (isRootFrame || isFunctionFrame) break;
    }
    return sp;
  }

  getVariable(
    name: string,
    node?: AstNode,
  ): { frame: IStackFrame; varInfo: IVariable } {
    let fpName = name;
    let inReach = true;

    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      const isGlobalFrame = frame.name.startsWith("__global");
      const isFunctionFrame = frame.kind === "function";

      if (isGlobalFrame) inReach = true;

      fpName = `${frame.name}.${fpName}`;
      if (inReach) {
        // search stack up to function level and global frames
        const varInfo = frame.variables.get(name);
        if (varInfo) return { frame, varInfo };
      }

      if (isFunctionFrame) inReach = false; // can't search in calling functions
    }
    throw new MinCompileError(`Symbol ${name} not found in frameStack`, node);
  }

  addLocalVariable(node: VariableDeclaration) {
    const frame = this.current(node);
    const isGlobalFrame = frame.name.startsWith("__global");

    const varInfo: IVariable = {
      name: node.name,
      kind: "local",
      type: node.type,
      location: isGlobalFrame ? "globalStack" : "stack",
      address: 0,
    };

    if (node.atExpr) {
      const address = constEval(node.atExpr);
      if (address === undefined)
        throw new MinCompileError(
          "Address must be a constant expression",
          node.atExpr,
        );
      varInfo.location = address <= 0xff ? "zeroPage" : "absolute";
      varInfo.address = address;
    } else {
      varInfo.address = this.getSP();
      const arrayInfo = isArray(node.assignExpr);
      if (arrayInfo.arrayType) {
        varInfo.type = `${node.type}*`;
        varInfo.count = arrayInfo.count;
        // if a fixed-size array, allocate space for it in the frame else allocate space (2 bytes) for a hidden pointer
        frame.frameSize +=
          arrayInfo.count == undefined
            ? 2 // variable-length array pointer
            : arrayInfo.count * (node.type == "int" ? 2 : 1);
      } else {
        frame.frameSize += node.type === "int" ? 2 : 1;
      }
    }

    frame.variables.set(varInfo.name, varInfo);
    return varInfo;
  }

  addParamVariable(node: NamedElement) {
    const frame = this.current(node);
    const varInfo: IVariable = {
      name: node.name,
      kind: "param",
      type: node.type,
      location: "stack",
      address: frame.frameSize,
    };
    frame.frameSize += 2; // all stack entries are 2 bytes because a char could be a char or a char array pointer
    frame.variables.set(varInfo.name, varInfo);
    return varInfo;
  }

  printFrame() {
    if (options.printFrame) {
      const frame = this.stack[this.stack.length - 1];
      out(`; frame summary for ${frame.name}`);
      frame.variables.forEach((v) =>
        out(`; ${v.name.padEnd(15)} : ${hexWord(v.address)} (${v.location})`),
      );
    }
  }

  buildFunctionFrame(def: Def) {
    // function stack frame is
    //           callerFP callerFP param0 param0 ... paramn paramn local0 local1  ... localn localn vla00 vla01 ....
    // fpOffset   0       1        2      3          ?      ?      ?      ?           ?      ?      ?     ?
    const frame = this.addFrame(def.name, "function");

    // add parameters to the frame
    def.params.forEach((param, i) => {
      frameStack.addParamVariable(param);
    });

    // add locals to the frame
    def.block.forEach((stmt) => {
      if (isVariableDeclaration(stmt)) this.addLocalVariable(stmt);
    });
  }

  buildBlockFrame(name: string, block: Array<LocalElement | SimpleStatement>) {
    const frame = this.addFrame(name, "block");
    block.forEach((stmt) => {
      if (isVariableDeclaration(stmt)) this.addLocalVariable(stmt);
    });
  }
}

export const frameStack = new FrameStack();
