import { MinCompileError, hexWord } from "../utils";
import * as expressionCompiler from "./expressions";
import * as variableCompiler from "./variables";
import type { IStackFrame, IVariableSymbol } from "./variables";
import {
  FunctionCall,
  type ReturnStatement,
  Def,
  CallStatement,
  LocalElement,
} from "../../ls/generated/ast";
import { compileStatement, out, format, options } from "./compiler";

function emitBlockPrologue(name: string, kind: "function" | "block") {
  // make z_FP  -= this.variableCompiler.currentFrame().frameSize which will point to the new stack frame base
  const newFPOffset = variableCompiler.currentFrame().frameSize;
  if (newFPOffset > 255)
    throw new MinCompileError(
      `Maximum frame size is 255, got ${newFPOffset} for ${name}`,
    );
  if (newFPOffset > 0) {
    out(
      `SIV ${variableCompiler.currentFrame().frameSize},z_FP`,
      "Prologue: z_FP = new frame base",
    );
  }
  const frame: IStackFrame = {
    name,
    kind,
    frameSize: 0,
    variables: new Map(),
  };
  variableCompiler.frameStack.push(frame);
  return frame;
}

function emitBlockEpilogue() {
  // make z_FP += this.variableCompiler.currentFrame().frameSize to pop the current frame off stack
  const poppedFrame = variableCompiler.frameStack.pop()!;
  printFrame(poppedFrame);
  const callerFrameSize = variableCompiler.currentFrame().frameSize;
  if (callerFrameSize > 0) {
    out(
      `AIV ${callerFrameSize},z_FP`,
      "Epilogue: restore z_FP to previous frame base",
    );
  }
}

export function compileDef(def: Def) {
  out("\n");
  out(
    `${def.name}:`,
    `params ${def.params.map((p) => p.type + ": " + p.name).join(", ")}`,
  );
  format.indent += 2;

  // Initialize the new stack frame for the function
  const frame = emitBlockPrologue(def.name, "function");

  def.params.forEach((param, i) => {
    const varSymbol: IVariableSymbol = {
      name: param.name,
      kind: "param",
      type: param.type,
      address: i * 2,
      count: 1,
      location: "stack",
    };
    frame.variables.set(param.name, varSymbol);
    frame.frameSize += 2;
  });

  def.block.forEach((stmt) => compileStatement(stmt));

  // Function epilogue
  emitBlockEpilogue();

  out(`RTS`);
  format.indent -= 2;
}

export function compileBlock(name: string, stmts: LocalElement[]) {
  format.indent += 2;
  emitBlockPrologue(name, "block");
  stmts.forEach((stmt) => compileStatement(stmt));
  emitBlockEpilogue();
  format.indent -= 2;
}

export function printFrame(frame: IStackFrame) {
  if (options.printFrame) {
    out(`; frame summary for ${frame.name} (${frame.kind})`);
    frame.variables.forEach((v) =>
      out(`; ${v.name.padEnd(15)} : ${hexWord(v.address)} (${v.location})`),
    );
  }
}

export function printFrameStack() {
  for (let i = variableCompiler.frameStack.length - 1; i >= 0; i--) {
    const frame = variableCompiler.frameStack[i];
    out(`; frame ${i}: ${frame.name} (${frame.kind})`);
    frame.variables.forEach((v) =>
      out(`;   ${v.name.padEnd(15)} : ${hexWord(v.address)} (${v.location})`),
    );
  }
}

export function compileReturn(node: ReturnStatement) {
  expressionCompiler.compileExpression(node.expr.exprs[0]);
  // stack pop and RTS are in Def epilogue
}

/** a function call statement ie  foo(arg1, arg2) with no or ignored return value */
export function compileFunctionCall(e: FunctionCall) {
  const functionName = e.functionName.$refText;
  const comment = `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`;

  // push the arguments into the callee's frame
  const newFrameBase = variableCompiler.currentFrame().frameSize;
  e.args.forEach((arg, i) => {
    expressionCompiler.compileExpression(arg.exprs[0]); // result -> z_A
    const offset = newFrameBase + i * 2;
    out(
      `MVV z_FP,z_PTR SIV ${offset},z_PTR JPS __sdZA`,
      `copy z_A to ${functionName} arg${i}`,
    );
  });

  out(`JPS ${functionName}`, comment);
  // return value convention: callee leaves result in __A
}

export function compileCallStatement(node: CallStatement) {
  out(
    `JPS ${hexWord(node.address.value)}`,
    `Call statement to address ${node.address.value}`,
  );
}
