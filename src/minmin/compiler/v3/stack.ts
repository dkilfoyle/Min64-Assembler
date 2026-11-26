import type { AstNode } from "langium";
import { hexWord, MinCompileError } from "../utils";
import type { IVariable } from "./variables";
import {
  GlobalElement,
  type Def,
  type LocalElement,
  type NamedElement,
  type SimpleStatement,
  type VariableDeclaration,
} from "../../ls/generated/ast";
import { constEval } from "./expressions";
import { options, out } from "./compiler";
import { isArray, isArraySizeDecl } from "./arrays";

export const POINTER_STACK_START = 0x2000;

export function emitRTPushZ(sourceZ: string, targetZ: "z_SP" | "z_SP2", type = "int", comment?: string) {
  if (type === "int") {
    out(`MZT ${sourceZ}+0,${targetZ} INV ${targetZ}`, comment || `push int ${sourceZ} LSB onto stack`);
    out(`MZT ${sourceZ}+1,${targetZ} INV ${targetZ}`, comment || `push int ${sourceZ} MSB onto stack`);
  } else {
    out(`MZT ${sourceZ}+0,${targetZ} INV ${targetZ}`, comment || `push char ${sourceZ} onto stack`);
  }
}

export function emitRTPopZ(sourceZ: string, destZ: string, type = "int", comment?: string) {
  if (type === "int") {
    out(`DEV ${sourceZ} MTZ ${sourceZ},${destZ}+1`, comment || `pop int LSB from stack ${destZ}`);
    out(`DEV ${sourceZ} MTZ ${sourceZ},${destZ}+0`, comment || `pop int MSB from stack ${destZ}`);
  } else {
    out(` DEV ${sourceZ} MTZ ${sourceZ},${destZ}+0`, comment || `pop char from stack ${destZ}`);
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

class Frame {
  name: string;
  kind: "function" | "global" | "globalBlock" | "functionBlock";
  variables: Map<string, IVariable>;
  frameSize: number;

  constructor(name: string, kind: "function" | "global" | "globalBlock" | "functionBlock") {
    this.name = name;
    this.kind = kind;
    this.variables = new Map();
    this.frameSize = 0;
  }

  addLocalVariable(node: VariableDeclaration) {
    const varInfo: IVariable = {
      name: node.name,
      kind: "local",
      type: node.type,
      location: this.kind.startsWith("global") ? "globalStack" : "stack",
      address: 0,
    };

    if (node.atExpr) {
      const address = constEval(node.atExpr);
      if (address === undefined) throw new MinCompileError("Address must be a constant expression", node.atExpr);
      varInfo.location = address <= 0xff ? "zeroPage" : "absolute";
      varInfo.address = address;
    } else {
      varInfo.address = this.frameSize;
      const isArrayDecl = isArraySizeDecl(node);

      if (isArrayDecl) {
        varInfo.type = `${node.type}*`;
        varInfo.count = constEval(isArrayDecl);
      } else {
        const arrayInfo = isArray(node.assignExpr);
        if (arrayInfo) {
          varInfo.type = `${node.type}*`;
          varInfo.count = arrayInfo.count;
        }
      }
      this.frameSize += 2; // all variable table entrie are 16 bit pointer
    }

    this.variables.set(varInfo.name, varInfo);
    return varInfo;
  }

  addParamVariable(node: NamedElement, index: number) {
    const varInfo: IVariable = {
      name: node.name,
      kind: "param",
      type: node.type,
      location: this.kind.startsWith("global") ? "globalStack" : "stack",
      address: this.frameSize,
    };
    this.frameSize += 2; // all variable table entries are 16 bit pointer
    this.variables.set(varInfo.name, varInfo);
    return varInfo;
  }

  addReturnVariable() {
    const varInfo: IVariable = {
      name: "__return",
      kind: "return",
      type: "unknown",
      location: "stack",
      address: this.frameSize,
    };
    this.frameSize += 2;
    this.variables.set(varInfo.name, varInfo);
    return varInfo;
  }

  print() {
    if (options.printFrame) {
      out(`; frame summary for ${this.name}`);
      this.variables.forEach((v) => out(`; ${v.name.padEnd(15)} : ${hexWord(v.address)} (${v.location})`));
    }
  }
}

class FrameStack {
  private stack: Frame[] = [];

  reset() {
    this.stack = [];
  }

  push(frame: Frame) {
    this.stack.push(frame);
  }

  pop(node?: AstNode): Frame {
    if (this.stack.length === 0) throw new MinCompileError("No stack frame to pop", node);
    return this.stack.pop()!;
  }

  current(node?: AstNode): Frame {
    const frame = this.stack.at(-1);
    if (!frame) throw new MinCompileError("No current stack frame", node);
    return frame;
  }

  getStack(): Frame[] {
    return this.stack;
  }

  getFunctionFrame() {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.kind === "function") return frame;
    }
    throw new MinCompileError("No function frame found");
  }

  getVariable(name: string, node?: AstNode): { frame: Frame; varInfo: IVariable; fpOffset?: number } {
    let fpName = name;
    let fpOffset = 0;
    let firstFunctionFrameIndex = -1;
    let firstMatchingVar: IVariable | undefined = undefined;

    if (name == "buf") debugger;

    // process
    // search down the stack
    // check if the current frame is in scope = we haven't reached the bottom of the current function frame yet, OR
    // we are in the global frame
    // if in scope AND we haven't found a matching variable yet, look for a match
    // once we find a match start accumulating the fpOffset until we reach the first function frame or bottom of stack

    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      const isGlobalFrame = frame.kind.startsWith("global");
      const isFunctionFrame = frame.kind === "function";
      if (isFunctionFrame && firstFunctionFrameIndex === -1) firstFunctionFrameIndex = i;
      const inScope = i >= firstFunctionFrameIndex || isGlobalFrame;

      if (inScope && !firstMatchingVar) {
        const varInfo = frame.variables.get(name);
        if (varInfo) {
          firstMatchingVar = varInfo;
          if (varInfo.location == "zeroPage" || varInfo.location == "absolute") return { frame, varInfo };
          fpOffset = varInfo.address;
        } else {
          fpOffset += frame.frameSize;
        }
      } else {
        fpOffset += frame.frameSize;
      }

      if (firstMatchingVar && (i == firstFunctionFrameIndex || i == 0)) {
        return { frame, varInfo: firstMatchingVar, fpOffset };
      }
    }
    throw new MinCompileError(`Symbol ${name} not found in frameStack`, node);
  }

  pushFunctionFrame(def: Def) {
    const frame = new Frame(def.name, "function");
    // add parameters to the frame
    for (let i = 0; i < def.params.length; i++) {
      frame.addParamVariable(def.params[i], i);
    }
    this.push(frame);
    return frame;
  }

  pushBlockFrame(name: string, block: Array<LocalElement | SimpleStatement>) {
    const parentFrame = frameStack.current();
    const frame = parentFrame.kind.startsWith("global") ? new Frame(name, "globalBlock") : new Frame(name, "functionBlock");
    this.push(frame);
    return frame;
  }

  pushGlobalFrame(block: Array<GlobalElement>) {
    const frame = new Frame("__g", "global");
    this.push(frame);
    return frame;
  }
}

export const frameStack = new FrameStack();
