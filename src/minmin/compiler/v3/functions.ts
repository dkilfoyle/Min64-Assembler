import { hexWord, MinCompileError } from "../utils";
import * as expressionCompiler from "./expressions";
import type { IExpressionType } from "./variables";
import {
  FunctionCall,
  type ReturnStatement,
  Def,
  CallStatement,
  LocalElement,
} from "../../ls/generated/ast";
import { compileStatement, out, format, options } from "./compiler";
import { frameStack, type IStackFrame } from "./stack";
import { cached } from "./cache";

function emitFunctionPrologue(name: string) {
  cached.unsetZA();
  const newFrame = frameStack.addFrame(name, "function");

  out(`${newFrame.name}_prologue:`, `function prologue`);
  format.indent += 2;
  out(`MZT z_FP+1,z_SP DEV z_SP`, `Save caller's frame pointer`);
  out(`MZT z_FP+0,z_SP DEV z_SP`, `Save caller's frame pointer`);
  out(`MZT z_HP+1,z_SP DEV z_SP`, `Save caller's heap pointer`);
  out(`MZT z_HP+0,z_SP DEV z_SP`, `Save caller's heap pointer`);
  out(`MVV z_SP,z_FP`, `Set frame pointer to current stack top`);
  format.indent -= 2;

  return newFrame;
}

function emitFunctionEpilogue() {
  frameStack.printFrame();
  const frame = frameStack.pop();
  if (frame.kind !== "function")
    throw new MinCompileError("Popped frame is not a function frame");

  out(`${frame.name}_end:`, `function epilogue`);
  format.indent += 2;

  out(`MVV z_FP,z_SP`, "pop locals off stack");
  out(`INV z_SP MTZ z_SP,z_HP+0`, "restore caller heap pointer");
  out(`INV z_SP MTZ z_SP,z_HP+1`, "restore caller heap pointer");
  out(`INV z_SP MTZ z_SP,z_FP+0`, "restore caller frame pointer");
  out(`INV z_SP MTZ z_SP,z_FP+1`, "restore caller frame pointer");

  format.indent -= 2;
  // cached.blockPath = cached.blockPath.slice(
  //   0,
  //   cached.blockPath.lastIndexOf("."),
  // );
}

export function compileDef(def: Def) {
  out("\n");
  out(
    `${def.name}:`,
    `params ${def.params.map((p) => p.type + ": " + p.name).join(", ")}`,
  );
  format.indent += 2;

  // Initialize the new stack frame for the function
  const frame = emitFunctionPrologue(def.name);

  let offsetFromFP = 4;
  def.params.forEach((param, i) => {
    offsetFromFP += param.type === "int" ? 2 : 1; // assuming all types are 2 bytes for now
    frameStack.addParamVariable(param, offsetFromFP);
  });

  def.block.forEach((stmt) => compileStatement(stmt));

  // Function epilogue
  emitFunctionEpilogue();

  out(`RTS`);
  format.indent -= 2;
}

export function compileReturn(node: ReturnStatement) {
  expressionCompiler.compileExpression(node.expr.exprs[0]);
  const functionFrame = frameStack.getFunctionFrame();

  out(`JPA ${functionFrame.name}_end`, `jump to function epilogue`);
  // stack pop and RTS are in Def epilogue
}

/** a function call statement ie  foo(arg1, arg2) with no or ignored return value */
export function compileFunctionCall(e: FunctionCall): IExpressionType {
  const functionName = e.functionName.$refText;
  const comment = `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`;

  // push the arguments onto caller's frame
  let argsSize = 0;
  e.args.forEach((arg, i) => {
    const argType = expressionCompiler.compileExpression(arg.exprs[0]); // result -> z_A
    argsSize += argType === "char" ? 1 : 2;
    if (argType == "char") {
      out(`MZT z_A+0,z_SP DEV z_SP`, `Push char argument ${i}`);
    } else {
      out(`MZT z_A+1,z_SP DEV z_SP`, `Push int argument ${i}`);
      out(`MZT z_A+0,z_SP DEV z_SP`, `Push int argument ${i}`);
    }
  });

  out(`JPS ${functionName}`, comment);
  if (argsSize > 0) {
    out(`AIV ${argsSize},z_SP`, `Pop arguments from caller's frame`);
  }
  // return value convention: callee leaves result in __A
  return "int";
}

export function compileCallStatement(node: CallStatement) {
  out(
    `JPS ${hexWord(node.address.value)}`,
    `Call statement to address ${node.address.value}`,
  );
}
