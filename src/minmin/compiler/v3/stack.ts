import type { AstNode } from "langium";
import { hexWord, MinCompileError } from "../utils";
import type { IVariable } from "./variables";
import {
  GlobalElement,
  isDef,
  isVariableDeclaration,
  Program,
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
import { getCompoundExpressionArraySize, getSliceLength, isArray, isArraySizeDecl } from "./arrays";

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
  kind: "function" | "block" | "global";
  variables: Map<string, IVariable>;
  frameSize: number;

  constructor(name: string, kind: "function" | "block" | "global") {
    this.name = name;
    this.kind = kind;
    this.variables = new Map();
    this.frameSize = 0;
  }

  addLocalVariable(node: VariableDeclaration) {
    const isGlobalFrame = this.name.startsWith("__global");

    const varInfo: IVariable = {
      name: node.name,
      kind: "local",
      type: node.type,
      location: "stack",
      address: 0,
    };

    if (node.atExpr) {
      const address = constEval(node.atExpr);
      if (address === undefined) throw new MinCompileError("Address must be a constant expression", node.atExpr);
      varInfo.location = address <= 0xff ? "zeroPage" : "absolute";
      varInfo.address = address;
    } else {
      varInfo.address = this.frameSize;
      const arrayInfo = isArray(node.assignExpr);
      if (arrayInfo?.arrayType) {
        varInfo.type = `${node.type}*`;
        varInfo.count = arrayInfo.count;
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
      location: "stack",
      address: this.frameSize, // index * 2 - 2, // address is a negative offset from FP0 with params added right to left
    };
    this.frameSize += 2; // all variable table entrie are 16 bit pointer
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

  getFirstStackVariable() {
    for (const [name, varInfo] of this.variables) {
      if (varInfo.location === "stack") return varInfo;
    }
    return undefined;
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

  getVariable(name: string, node?: AstNode): { frame: Frame; varInfo: IVariable } {
    let fpName = name;
    let inReach = true;

    // TODO: Implement proper scoping rules for variable lookup, including handling of nested functions and blocks.
    // return accumulated offset by summing frame sizes from the current frame up to the frame containing the variable

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
    debugger;
    throw new MinCompileError(`Symbol ${name} not found in frameStack ${fpName}`, node);
  }

  buildFunctionFrame(def: Def) {
    // function stack frame is
    // params - 2 bytes each, right to left, address is a negative offset from FP0
    // FP - 2 bytes = FP0
    // locals with known compile time size
    // variable sized arrays and parameters to called functions
    const frame = new Frame(def.name, "function");

    // add parameters to the frame
    for (let i = 0; i < def.params.length; i++) {
      frame.addParamVariable(def.params[i], i);
    }

    // add locals to the frame
    // def.block.forEach((stmt) => {
    //   if (isVariableDeclaration(stmt)) frame.addLocalVariable(stmt);
    // });

    return frame;
  }

  buildBlockFrame(name: string, block: Array<LocalElement | SimpleStatement>) {
    const frame = new Frame(name, "block");
    // block.forEach((stmt) => {
    //   if (isVariableDeclaration(stmt)) frame.addLocalVariable(stmt);
    // });
    return frame;
  }

  buildGlobalFrame(block: Array<GlobalElement>) {
    const frame = new Frame("__global", "global");
    // block.forEach((stmt) => {
    //   if (isVariableDeclaration(stmt)) frame.addLocalVariable(stmt);
    // });
    return frame;
  }

  pushFunctionFrame(def: Def) {
    const frame = this.buildFunctionFrame(def);
    this.push(frame);
    return frame;
  }

  pushBlockFrame(name: string, block: Array<LocalElement | SimpleStatement>) {
    const frame = this.buildBlockFrame(name, block);
    this.push(frame);
    return frame;
  }

  pushGlobalFrame(block: Array<GlobalElement>) {
    const frame = this.buildGlobalFrame(block);
    this.push(frame);
    return frame;
  }
}

export const frameStack = new FrameStack();
