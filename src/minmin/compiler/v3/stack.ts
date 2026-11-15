import type { AstNode } from "langium";
import { hexWord, MinCompileError } from "../utils";
import type { IVariable } from "./variables";
import {
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

class Frame {
  name: string;
  kind: "function" | "block" | "global";
  variables: Map<string, IVariable>;
  frameSize: number;

  constructor(name: string, kind: "function" | "block" | "global") {
    this.name = name;
    this.kind = kind;
    this.variables = new Map();
    this.frameSize = kind == "function" ? 2 : 0;
  } 

addLocalVariable(node: VariableDeclaration) {
    const isGlobalFrame = this.name.startsWith("__global");

    const varInfo: IVariable = {
      name: node.name,
      kind: "local",
      type: node.type,
      location: isGlobalFrame ? "globalStack" : "stack",
      address: 0,
    };

    if (node.atExpr) {
      const address = constEval(node.atExpr);
      if (address === undefined) throw new MinCompileError("Address must be a constant expression", node.atExpr);
      varInfo.location = address <= 0xff ? "zeroPage" : "absolute";
      varInfo.address = address;
    } else {
      varInfo.address = this.getSP();
      const arrayInfo = isArray(node.assignExpr);
      if (arrayInfo?.arrayType) {
        varInfo.type = `${node.type}*`;
        varInfo.count = arrayInfo.count;
        // if a fixed-size array, allocate space for it in the frame else allocate space (2 bytes) for a hidden pointer
        this.frameSize +=
          arrayInfo.count == undefined
            ? 2 // variable-length array pointer
            : arrayInfo.count * (node.type == "int" ? 2 : 1);
      } else {
        this.frameSize += node.type === "int" ? 2 : 1;
      }
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
      address: index * 2 - 2, // address is a negative offset from FP0 with params added right to left
    };
    this.frameSize += 2; // all stack param entries are 2 bytes because a char could be a char or a char array pointer
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
  private stack:  Frame[] = [];
  private functionFrames = new Map<string, Frame>(); // precomputed function frames

  reset() {
    this.stack = [];
    this.functionFrames.clear();
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

  

  buildFunctionFrame(def: Def) {
    // function stack frame is
    // params - 2 bytes each, right to left, address is a negative offset from FP0
    // FP - 2 bytes = FP0
    // locals with known compile time size
    // variable sized arrays and parameters to called functions

           const frame: IStackFrame = {
      name: def.name,
      kind: "function",
      variables: new Map(),
      frameSize: 2, // function frame includes framepointer
    };

    // add parameters to the frame
    for (let i = def.params.length - 1; i >= 0; i--) {
      frameStack.addParamVariable(def.params[i], i);
    }

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

  precomputeFunctionFrame(def: Def) {

    this.functionFrames.set(def.name, frame);
  }

  precomputeAllFunctionFrames(mainProgram: Program) {
  mainProgram.elements.forEach((el) => {
    if (isDef(el)) frameStack.precomputeFunctionFrame(el);
  });
}
}

export function 

export const frameStack = new FrameStack();
