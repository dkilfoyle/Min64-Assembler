import { hexWord, MinCompileError } from "../utils";
import { type IExpressionType } from "./variables";
import { FunctionCall, type ReturnStatement, Def, CallStatement, isCallStatement, isReturnStatement } from "../../ls/generated/ast";
import { compileStatement, out, format, reachableDefs } from "./compiler";
import { emitRTPopZ, emitRTPushZ, frameStack } from "./stack";
import { cached } from "./cache";
import { compileCompoundExpression, isArray } from "./arrays";
import { compileExpression, emitHWPopZ, emitHWPushZ } from "./expressions";
import { emitGetPtr } from "./pointers";

function emitFunctionEpilogue() {
  const frame = frameStack.current();
  if (frame.kind !== "function") throw new MinCompileError("Popped frame is not a function frame");

  out(`${frame.name}_end:`, `function epilogue`);
  format.indent += 2;

  if (frame.frameSize > 0) {
    // pop the pointer frame SP2 back to FP2
    out(`MVV z_FP2,z_SP2`, `pop SP2 pointer frame`); // SP2 now points to the pointer to first stack variable

    // pop the data frame (z_SP)
    out(`MRZ z_SP2,z_SP+0 INV z_SP2`, `pop SP data frame`);
    out(`MRZ z_SP2,z_SP+1 DEV z_SP2`, `pop SP data frame`);
  }

  // restore callers FP2
  emitRTPopZ("z_SP2", "z_FP2", "int", `restore caller's frame pointer`);

  frame.print();
  format.indent -= 2;
  frameStack.pop();
  // cached.blockPath = cached.blockPath.slice(
  //   0,
  //   cached.blockPath.lastIndexOf("."),
  // );
}

export function compileDef(def: Def) {
  out("\n");
  out(`${def.name}:`, `params ${def.params.map((p) => p.type + ": " + p.name).join(", ")}`);
  format.indent += 2;

  frameStack.pushFunctionFrame(def);

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
  const callerFrame = frameStack.current();

  const comment = `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`;

  // Save the caller's frame pointer
  emitRTPushZ("z_FP2", "z_SP2", "int", `push caller's frame pointer`);

  if (e.args.length > 0) {
    // Save the current pointer stack
    emitHWPushZ("z_SP2", `save current pointer stack => new FP2`);

    // push the arguments onto caller's frame using caller's frame pointer
    for (let i = 0; i < e.args.length; i++) {
      const arg = e.args[i];
      const paramType = functionDef.params[i].type;
      emitRTPushZ("z_SP", "z_SP2", "int", `save pointer to argument ${i}`);
      compileCompoundExpression(arg, "z_SP", paramType);
    }

    // Set the new FP2
    emitHWPopZ("z_FP2", `pop the stored SP2 to become the new FP2`);
  } else {
    out(`MVV z_SP2,z_FP2`, `no arguments, FP2 starts here`);
  }

  out(`JPS ${functionName}`, comment);
  // return value will be in z_A

  return "int";
}

export function compileCallStatement(node: CallStatement) {
  out(`JPS ${hexWord(node.address.value)}`, `Call statement to address ${node.address.value}`);
}

export function compileReturn(node: ReturnStatement) {
  const functionFrame = frameStack.getFunctionFrame();

  out(`PHS`);
  emitRTPushZ("z_SP", "z_SP2", "int", `save pointer to return value on pointer stack`);
  out(`PLS`);

  functionFrame.addReturnVariable();
  compileCompoundExpression(node.expr, "z_SP", "unknown");

  if (isArray(node.expr)) {
    // length will be current z_SP - saved z_SP
    emitRTPopZ("z_SP2", "z_A", "int", `z_A = &returned array`);
    out(`MVV z_SP,z_B SVV z_PTR,z_B`, `z_B = num of bytes in return value`);
    throw new MinCompileError(`Array return values not yet supported`, node);
  }

  out(`JPA ${functionFrame.name}_end`, `jump to function epilogue`);
  // stack pop and RTS are in Def epilogue
}
