import type { AstNode } from "langium";
import { hexWord, MinCompileError } from "../utils";
import type { IVariable } from "./variables";
import type { NamedElement, VariableDeclaration } from "../../ls/generated/ast";
import { constEval } from "./expressions";
import { options, out } from "./compiler";

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

// Frame layout
// stack grows upwards, all int values stored as LSB MSB
// each frame starts with it's parents frame pointer (FP) = offset 0
// then come the function arguments, followed by local variables
// z_PTR points to the top of the stack, the next free address
// z_PTR points to the currently selected stack variable, address of the LSB

/*
def bla():
  int x = 0
  int y = 0
  char c = c[0|3]
  foo(x,y,c)
  return
def foo(int j, int k, char myarray):
  int z = 0
  return

  varName  | mainFP0 | mainFP1 | x0 | x1 | y0 | y1 | c0 | c1 | c2 | c3 | blaFP0 | blaFP1 | j0 | j1 | k0 | k1 | myarray0 | myarray1 | myarray2 | myarray3 | z0 | z1
  z_FP     | bla     |         |    |    |    |    |    |    |    |    | foo    |        |    |    |    |    |          |          |          |          |    |
  FPOffset | 0       | 1       | 2  | 3  | 4  | 5  | 6  | 7  | 8  | 9  | 0      | 1      | 2  | 3  | 4  | 5  | 6        | 7        | 8        | 9        | 10 | 11

*/

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
    if (this.stack.length === 0) throw new MinCompileError("No stack frame to pop", node);
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

  getVariable(name: string, node?: AstNode): { frame: IStackFrame; varInfo: IVariable } {
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

  addLocalVariable(node: VariableDeclaration, arraySize: number) {
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
      varInfo.location = address <= 0xff ? "zeroPage" : "absolute";
      varInfo.address = address;
      frame.variables.set(varInfo.name, varInfo);
    } else if (arraySize > 0) {
      varInfo.address = this.getSP();
      frame.variables.set(varInfo.name, varInfo);
      frame.frameSize += arraySize * (node.type === "int" ? 2 : 1);
    } else {
      varInfo.address = this.getSP();
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

  printFrame() {
    if (options.printFrame) {
      const frame = this.stack[this.stack.length - 1];
      out(`; frame summary for ${frame.name}`);
      frame.variables.forEach((v) => out(`; ${v.name.padEnd(15)} : ${hexWord(v.address)} (${v.location})`));
    }
  }
}

export const frameStack = new FrameStack();
