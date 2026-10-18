import { hexWord } from "../utils";
import * as expressionCompiler from "./expressions";
import type { IExpressionType } from "./variables";
import {
  FunctionCall,
  type ReturnStatement,
  Def,
  CallStatement,
  LocalElement,
} from "../../ls/generated/ast";
import { compileStatement, out, format, options, cached } from "./compiler";
import { frameStack, type IStackFrame } from "./stack";

function emitFunctionPrologue(name: string) {
  cached.blockPath += "." + name;
  const newFrame = frameStack.addFrame(name, "function");

  out(`${newFrame.name}_prologue:`, `function prologue`);
  format.indent += 2;
  out(`MVV z_SP,z_PTR`, `Save old stack top`);
  out(`MZT z_FP+1,z_SP DEV z_SP`, `Save caller's frame pointer`);
  out(`MZT z_FP+0,z_SP DEV z_SP`, `Save caller's frame pointer`);
  out(`MZT z_HP+1,z_SP DEV z_SP`, `Save caller's heap pointer`);
  out(`MZT z_HP+0,z_SP DEV z_SP`, `Save caller's heap pointer`);
  out(`MVV z_PTR,z_FP`, `Set frame pointer to old stack top`);
  newFrame.frameSize += 4;
  format.indent -= 2;

  return newFrame;
}

function emitFunctionEpilogue() {
  // make z_FP += this.variableCompiler.currentFrame().frameSize to pop the current frame off stack
  const { localSize, frameCount, frame } = frameStack.popToFunctionFrame();

  printFrame(frame);
  if (localSize > 0) {
    out(`ADD z_SP,${localSize}`, `Pop local stack frames (${frameCount})`);
  }

  out(`${frame.name}_end:`, `function epilogue`);
  format.indent += 2;

  out(`AIV ${frame.frameSize - 4},z_SP`, "Epilogue: pop locals off stack");
  out(`INV z_SP MTZ z_SP,z_HP+0`, "Epilogue: restore caller heap pointer");
  out(`INV z_SP MTZ z_SP,z_HP+1`, "Epilogue: restore caller heap pointer");
  out(`INV z_SP MTZ z_SP,z_FP+0`, "Epilogue: restore caller frame pointer");
  out(`INV z_SP MTZ z_SP,z_FP+1`, "Epilogue: restore caller frame pointer");

  format.indent -= 2;
  cached.blockPath = cached.blockPath.slice(
    0,
    cached.blockPath.lastIndexOf("."),
  );
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

  let offsetFromFP = 0;
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

export function printFrame(frame: IStackFrame) {
  if (options.printFrame) {
    out(`; frame summary for ${frame.name} (${frame.kind})`);
    frame.variables.forEach((v) =>
      out(`; ${v.name.padEnd(15)} : ${hexWord(v.address)} (${v.location})`),
    );
  }
}

export function printFrameStack() {
  for (let i = frameStack.getStack().length - 1; i >= 0; i--) {
    const frame = frameStack.getStack()[i];
    out(`; frame ${i}: ${frame.name} (${frame.kind})`);
    frame.variables.forEach((v) =>
      out(`;   ${v.name.padEnd(15)} : ${hexWord(v.address)} (${v.location})`),
    );
  }
}

export function compileReturn(node: ReturnStatement) {
  expressionCompiler.compileExpression(node.expr.exprs[0]);
  const functionFrame = frameStack.getFunctionFrame();

  out(`JPS ${functionFrame.name}_end`, `jump to function epilogue`);
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
      out(`MZT z_A+0,z_SP DEV z_SP`, `Push int argument ${i}`);
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
