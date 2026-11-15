import { hexWord, MinCompileError } from "../utils";
import { type IExpressionType } from "./variables";
import { FunctionCall, type ReturnStatement, Def, CallStatement } from "../../ls/generated/ast";
import { compileStatement, out, format, reachableDefs } from "./compiler";
import { emitRTPushZ, frameStack } from "./stack";
import { cached } from "./cache";
import { compileCompoundExpression, isArray } from "./arrays";
import { compileExpression, emitHWPopZ, emitHWPushZ } from "./expressions";

export function emitPreallocateStack() {
  const frameSize = frameStack.current().frameSize;
  if (frameSize > 0) {
    out(`MIV ${hexWord(frameSize)},z_SP`, `Allocate space for local variables on stack`);
    out(`AVV z_FP,z_SP`, `z_SP = z_FP + fixed frame size`);
  }
}

function emitFunctionPrologue() {
  cached.unsetZA();
  out(`${frameStack.current().name}_prologue:`, `function prologue`);
  format.indent += 2;
  out(`MZT z_FP+0,z_SP INV z_SP`, `Save caller's frame pointer`);
  out(`MZT z_FP+1,z_SP INV z_SP`, `Save caller's frame pointer`);
  out(`MVV z_SP,z_FP`, `Init new frame pointer`);
  emitPreallocateStack();
  format.indent -= 2;
}

function emitFunctionEpilogue() {
  frameStack.printFrame();
  const frame = frameStack.pop();
  if (frame.kind !== "function") throw new MinCompileError("Popped frame is not a function frame");

  out(`${frame.name}_end:`, `function epilogue`);
  format.indent += 2;
  out(`MVV z_FP,z_SP`, "pop locals off stack");
  out(`DEV z_SP MTZ z_SP,z_FP+1`, "restore caller frame pointer");
  out(`DEV z_SP MTZ z_SP,z_FP+0`, "restore caller frame pointer");
  format.indent -= 2;
  // cached.blockPath = cached.blockPath.slice(
  //   0,
  //   cached.blockPath.lastIndexOf("."),
  // );
}

export function compileDef(def: Def) {
  out("\n");
  out(`${def.name}:`, `params ${def.params.map((p) => p.type + ": " + p.name).join(", ")}`);
  format.indent += 2;

  frameStack.buildFunctionFrame(def);

  emitFunctionPrologue();
  def.block.forEach((stmt) => compileStatement(stmt));
  emitFunctionEpilogue();

  out(`RTS`);
  format.indent -= 2;
}

/** a function call statement ie  foo(arg1, arg2) with no or ignored return value */
export function compileFunctionCall(e: FunctionCall): IExpressionType {
  const functionName = e.functionName.$refText;
  const functionDef = reachableDefs.find((def) => def.name === functionName);
  if (!functionDef) throw new MinCompileError(`Function definition not found for ${functionName}`, e);

  const comment = `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`;

  // push the arguments onto caller's frame in reverse order (right to left)
  // arrays are pushed as a pointer with the array value copied into the callee's variable frame from z_SP2
  e.args.forEach((arg, i) => {
    const paramType = functionDef.params[i].type;
    if (isArray(arg)) {
      emitRTPushZ("z_SP", "int"); // push z_SP onto the stack as pointer to this array
      compileCompoundExpression(arg, "z_SP2", paramType); // build the array from SP2
    }
    compileCompoundExpression(arg, "z_SP", paramType);
  });

  out(`JPS ${functionName}`, comment);
  // return value will be at top of the stack

  return "int";
}

export function compileCallStatement(node: CallStatement) {
  out(`JPS ${hexWord(node.address.value)}`, `Call statement to address ${node.address.value}`);
}

export function compileReturn(node: ReturnStatement) {
  // if return expression is an array return pointer in z_A else return value in z_A
  if (isArray(node.expr)) {
    emitHWPushZ("z_SP");
    compileCompoundExpression(node.expr, "z_SP", "unknown");
    emitHWPopZ();
  } else {
    compileExpression(node.expr.exprs[0]);
  }

  const functionFrame = frameStack.getFunctionFrame();

  out(`JPA ${functionFrame.name}_end`, `jump to function epilogue`);
  // stack pop and RTS are in Def epilogue
}
