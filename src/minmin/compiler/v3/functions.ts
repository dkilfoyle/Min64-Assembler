import { hexWord } from "../utils";
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
import { compileStatement, out, outi } from "./compiler";

export function compileDef(def: Def) {
  out("\n");
  out(
    `${def.name}:`,
    `params ${def.params.map((p) => p.type + ": " + p.name).join(", ")}`,
  );

  // Initialize the new stack frame for the function
  const frame: IStackFrame = {
    name: def.name,
    kind: "function",
    frameSize: 0,
    variables: new Map(),
  };
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
  variableCompiler.frameStack.push(frame);

  def.block.forEach((stmt) => compileStatement(stmt));

  // Function epilogue
  const poppedFrame = variableCompiler.frameStack.pop()!;
  outi(`AIV ${poppedFrame.frameSize},z_FP`, `Pop the current frame off stack`);
  printFrame(poppedFrame);
  outi(`RTS`);
}

export function compileBlock(name: string, stmts: LocalElement[]) {
  const lastFrame = variableCompiler.frameStack.at(-1)!;
  const frame: IStackFrame = {
    name: name,
    kind: "block",
    frameSize: 0,
    variables: new Map(),
  };
  variableCompiler.frameStack.push(frame);
  outi(`SIV ${lastFrame.frameSize},z_FP`, `z_FP = ${name}`);
  stmts.forEach((stmt) => compileStatement(stmt));
  const poppedFrame = variableCompiler.frameStack.pop();
  if (poppedFrame) {
    printFrame(poppedFrame);
  }
  outi(`AIV ${frame.frameSize},z_FP`, `Pop the current frame off stack`);
}

export function printFrame(frame: IStackFrame) {
  out(`  ; frame summary`);
  frame.variables.forEach((v) =>
    out(`  ; ${v.name.padEnd(20)} : ${v.address}`),
  );
}

export function compileReturn(node: ReturnStatement) {
  expressionCompiler.compileExpression(node.expr.exprs[0]);
  // stack pop and RTS are in Def epilogue
}

/** a function call statement ie  foo(arg1, arg2) with no or ignored return value */
export function compileFunctionCall(e: FunctionCall) {
  const functionName = e.functionName.$refText;

  // push the arguments into the callee's frame
  e.args.forEach((arg, i) => {
    expressionCompiler.compileExpression(arg.exprs[0]); // result -> z_A
    const offset = variableCompiler.currentFrame().frameSize + i * 2;
    outi(
      `MVV z_FP,z_PTR SIV ${offset},z_PTR JPS __sdZA`,
      `copy z_A to ${functionName} arg${i}`,
    );
  });

  // make z_FP  -= this.variableCompiler.currentFrame().frameSize which will point to the new stack frame base
  outi(
    `SIV ${variableCompiler.currentFrame().frameSize},z_FP`,
    `z_FP = ${functionName}`,
  );

  outi(
    `JPS ${functionName}`,
    `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`,
  );

  // return value convention: callee leaves result in __A
}

export function compileCallStatement(node: CallStatement) {
  outi(
    `JPS ${hexWord(node.address.value)}`,
    `Call statement to address ${node.address.value}`,
  );
}
