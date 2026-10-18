import type { AstNode } from "langium";
import { MinCompileError } from "../utils";
import type { IVariable } from "./variables";
import type { NamedElement, VariableDeclaration } from "../../ls/generated/ast";
import { constEval } from "./expressions";
import { out } from "./compiler";

export function emitRTPushZ(sourceZ: string) {
  out(`MZT ${sourceZ}+1,z_SP DEV z_SP`, `push ${sourceZ} onto stack`);
  out(`MZT ${sourceZ}+0,z_SP DEV z_SP`, `push ${sourceZ} onto stack`);
}

export interface IStackFrame {
  name: string;
  kind: "function" | "block" | "global";
  variables: Map<string, IVariable>;
  frameSize: number;
  heapSize: number;
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

  popToFunctionFrame(node?: AstNode): {
    frame: IStackFrame;
    localSize: number;
    frameCount: number;
  } {
    let frame = this.pop(node);
    let localSize = 0;
    let frameCount = 0;
    while (frame && frame.kind !== "function") {
      localSize += frame.frameSize;
      frameCount++;
      frame = this.pop(node);
    }
    if (!frame) throw new MinCompileError("No function frame to pop to", node);
    return { frame, localSize, frameCount };
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
      frameSize: 0,
      heapSize: 0,
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

  addLocalVariable(node: VariableDeclaration, isArray: boolean) {
    const frame = this.current(node);
    const isGlobalFrame = frame.name.startsWith("__global");

    const varInfo: IVariable = {
      name: node.name,
      kind: "local",
      type: "int",
      location: isGlobalFrame ? "globalStack" : "stack",
      address: 0,
    };

    if (node.atExpr) {
      const address = constEval(node.atExpr);
      varInfo.type = node.type === "int" ? "int*" : "char*";
      varInfo.location = address <= 0xff ? "zeroPage" : "absolute";
      varInfo.address = address;
      frame.variables.set(varInfo.name, varInfo);
    } else if (isArray) {
      varInfo.type = node.type === "int" ? "int*" : "char*";
      varInfo.address = this.getSP();
      frame.variables.set(varInfo.name, varInfo);
      frame.frameSize += 2;
      frame.heapSize += 1;
    } else {
      varInfo.type = node.type;
      varInfo.address = frame.frameSize;
      frame.variables.set(varInfo.name, varInfo);
      frame.frameSize += node.type === "int" ? 2 : 1;
    }
    return varInfo;
  }

  addParamVariable(node: NamedElement, offsetFromFP: number) {
    const frame = this.current(node);
    const varInfo: IVariable = {
      name: node.name,
      kind: "param",
      type: node.type,
      location: "stack",
      address: offsetFromFP,
    };
    frame.variables.set(varInfo.name, varInfo);
    return varInfo;
  }
}

export const frameStack = new FrameStack();
