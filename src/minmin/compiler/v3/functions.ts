import { hexWord, MinCompileError } from "../utils";
import { type IExpressionType } from "./variables";
import { FunctionCall, type ReturnStatement, Def, CallStatement } from "../../ls/generated/ast";
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

  const firstStackVar = frame.getFirstStackVariable();
  if (firstStackVar) {
    emitGetPtr("z_PTR2", firstStackVar!.name); // get the first stack var, its pointer is the frame start

    // const returnVar = frame.variables.get("__return");
    // if (returnVar) {
    //   // copy z_B bytes from z_PTR to z_PTR2
    //   // compileReturn has already set up z_B and z_PTR
    //   // TODO: This is only necessary for returned arrays
    //   // out(`JPS __memCopy`);
    //   out(`MVV z_PTR2,z_SP`, `z_SP points to end of return value`);
    // } else {
    //   out(`MVV z_PTR2,z_SP`, `pop the data frame`);
    // }
    out(`MVV z_PTR2,z_SP`, `pop the data frame`);
    out(`MIV ${hexWord(frame.frameSize)},z_TMP1 SVV z_TMP1,z_SP2`, `pop the ptr frame`);
  }

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

  const comment = `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`;

  // push the arguments onto caller's frame
  // arrays are pushed as a pointer with the array value copied into the callee's variable frame from z_SP2
  for (let i = 0; i < e.args.length; i++) {
    const arg = e.args[i];
    const paramType = functionDef.params[i].type;
    emitRTPushZ("z_SP", "z_SP2", "int", `save pointer to argument ${i}`);
    compileCompoundExpression(arg, "z_SP", paramType);
  }

  out(`JPS ${functionName}`, comment);
  // return value will be in z_A

  return "int";
}

export function compileCallStatement(node: CallStatement) {
  out(`JPS ${hexWord(node.address.value)}`, `Call statement to address ${node.address.value}`);
}

export function compileReturn(node: ReturnStatement) {
  // compile the return expression onto the stack
  // and push a pointer to it to the variable table
  out(`PHS`);
  emitRTPushZ("z_SP", "z_SP2", "int", `save pointer to return value on pointer stack`);
  out(`PLS`);
  compileCompoundExpression(node.expr, "z_SP", "unknown");

  if (isArray(node.expr)) {
    // length will be current z_SP - saved z_SP
    emitRTPopZ("z_SP2", "z_A", "int", `z_A = &returned array`);
    out(`MVV z_SP,z_B SVV z_PTR,z_B`, `z_B = num of bytes in return value`);
  } else {
    // not an array, so z_A already contains the return value
    // out(`MIV 0x0000,z_B`, `z_B = 0 as result is not array`); // perhaps not necessary
  }

  const functionFrame = frameStack.getFunctionFrame();
  functionFrame.addReturnVariable();

  out(`JPA ${functionFrame.name}_end`, `jump to function epilogue`);
  // stack pop and RTS are in Def epilogue
}
