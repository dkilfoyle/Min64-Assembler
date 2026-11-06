import { hexWord, MinCompileError } from "../utils";
import * as expressionCompiler from "./expressions";
import { isArrayDecl, type IExpressionType } from "./variables";
import {
  FunctionCall,
  type ReturnStatement,
  Def,
  CallStatement,
  LocalElement,
  isVariableDeclaration,
  isWhile,
  isIf,
  isFunctionCall,
  isDef,
} from "../../ls/generated/ast";
import { compileStatement, out, format, options, assembly, reachableDefs } from "./compiler";
import { frameStack, type IStackFrame } from "./stack";
import { cached } from "./cache";
import type { AstNode } from "langium";

function emitFunctionPrologue(name: string, hasHeapAllocation: boolean) {
  cached.unsetZA();
  const newFrame = frameStack.addFrame(name, "function");

  out(`${newFrame.name}_prologue:`, `function prologue`);
  format.indent += 2;
  out(`MZT z_FP+1,z_SP DEV z_SP`, `Save caller's frame pointer`);
  out(`MZT z_FP+0,z_SP DEV z_SP`, `Save caller's frame pointer`);
  if (hasHeapAllocation) {
    out(`MZT z_HP+1,z_SP DEV z_SP`, `Save caller's heap pointer`);
    out(`MZT z_HP+0,z_SP DEV z_SP`, `Save caller's heap pointer`);
  }
  out(`MVV z_SP,z_FP`, `Set frame pointer to current stack top`);
  format.indent -= 2;

  return newFrame;
}

function emitFunctionEpilogue(hasHeapAllocation: boolean) {
  frameStack.printFrame();
  const frame = frameStack.pop();
  if (frame.kind !== "function") throw new MinCompileError("Popped frame is not a function frame");

  out(`${frame.name}_end:`, `function epilogue`);
  format.indent += 2;
  out(`MVV z_FP,z_SP`, "pop locals off stack");
  if (hasHeapAllocation) {
    out(`INV z_SP MTZ z_SP,z_HP+0`, "restore caller heap pointer");
    out(`INV z_SP MTZ z_SP,z_HP+1`, "restore caller heap pointer");
  }
  out(`INV z_SP MTZ z_SP,z_FP+0`, "restore caller frame pointer");
  out(`INV z_SP MTZ z_SP,z_FP+1`, "restore caller frame pointer");
  format.indent -= 2;
  // cached.blockPath = cached.blockPath.slice(
  //   0,
  //   cached.blockPath.lastIndexOf("."),
  // );
}

function findHeapAllocation(node: AstNode) {
  if (isVariableDeclaration(node)) {
    if (isArrayDecl(node).isArray) return true;
  }
  if (isWhile(node)) {
    for (const stmt of node.block) {
      if (findHeapAllocation(stmt)) return true;
    }
  }
  if (isIf(node)) {
    const stmts = [...node.block, ...(node.elseBlock?.block ?? []), ...node.elifs.map((e) => e.block).flat()];
    for (const stmt of stmts) {
      if (findHeapAllocation(stmt)) return true;
    }
  }
  return false;
}

// function findStackAllocation(node: AstNode) {
//   if (isVariableDeclaration(node)) {
//     return node.atExpr == undefined; // atExprs don't go on stack
//   }
//   if (isDef(node)) {
//     return node.params.length > 0 ? true : false;
//   }
//   if (isWhile(node)) {
//     for (const stmt of node.block) {
//       if (findStackAllocation(stmt)) return true;
//     }
//   }
//   if (isIf(node)) {
//     const stmts = [
//       ...node.block,
//       ...(node.elseBlock?.block ?? []),
//       ...node.elifs.map((e) => e.block).flat(),
//     ];
//     for (const stmt of stmts) {
//       if (findStackAllocation(stmt)) return true;
//     }
//   }
//   return false;
// }

export function compileDef(def: Def) {
  out("\n");
  out(`${def.name}:`, `params ${def.params.map((p) => p.type + ": " + p.name).join(", ")}`);
  format.indent += 2;

  const hasHeapAllocation = findHeapAllocation(def);

  // Initialize the new stack frame for the function
  const frame = emitFunctionPrologue(def.name, hasHeapAllocation);

  // FP OldFP OldFP paramL paramH
  // 0  1     2     3      4
  let offsetFromFP = hasHeapAllocation ? 4 : 2;
  def.params.forEach((param, i) => {
    offsetFromFP += param.type == "char" ? 1 : 2;
    frameStack.addParamVariable(param, offsetFromFP);
  });

  def.block.forEach((stmt) => compileStatement(stmt));

  // Function epilogue
  emitFunctionEpilogue(hasHeapAllocation);

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
  const functionDef = reachableDefs.find((def) => def.name === functionName);
  if (!functionDef) throw new MinCompileError(`Function definition not found for ${functionName}`, e);

  const comment = `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`;

  // push the arguments onto caller's frame in reverse order (right to left)
  let argsSize = 0;
  const args = e.args.slice().reverse(); // reverse the arguments for right-to-left pushing
  args.forEach((arg, i) => {
    const argn = args.length - i;
    const argType = expressionCompiler.compileExpression(arg.exprs[0]); // result -> z_A
    const paramType = functionDef.params[i].type;

    // in min everything is passed by value
    // given:
    // def bla(char c):...
    // char x = 0_1_2_3_4
    // then:
    // bla("a") pushes a.charCode
    // bla(x) pushes a full copy of x (all 8-bit elements) so bla can refer to eg c[2]
    // so:
    // any variable can be referenced with an index
    // to make this work the variable stack offset must be for the LSB for both locals and params

    // cast args to the parameter type if necessary
    if (paramType == "char") {
      switch (argType) {
        case "char":
        case "int": // cast int to char
          argsSize += 1;
          out(`MZT z_A+0,z_SP DEV z_SP`, `Push LSB argument ${argn} (${arg.exprs[0].$cstNode?.text})`);
          break;
        case "int*":
          throw new MinCompileError(`Cannot cast int* to char`, arg.exprs[0]);
        // TODO: push a full copy of the array onto the stack in reverse element order or error or warning??
        case "char*":
          // TODO: push a full copy of the array onto the stack in reverse element order
          throw new MinCompileError(`Cannot cast char* to char - should this be char[0]?`, arg.exprs[0]);
        default:
          throw Error(`Unsupported argument type ${argType}`);
      }
    } else if (paramType == "int") {
      switch (argType) {
        case "char":
          // sign extend char to int
          argsSize += 2;
          out(`LDZ z_A+0 JPS _signext`, `Sign extend LSB to MSB for argument ${argn} (${arg.exprs[0].$cstNode?.text})`);
          out(`MZT z_A+1,z_SP DEV z_SP`, `Push MSB argument ${argn} (${arg.exprs[0].$cstNode?.text})`);
          out(`MZT z_A+0,z_SP DEV z_SP`, `Push LSB argument ${argn} (${arg.exprs[0].$cstNode?.text})`);
          break;
        case "int":
          argsSize += 2;
          out(`MZT z_A+1,z_SP DEV z_SP`, `Push MSB argument ${argn} (${arg.exprs[0].$cstNode?.text})`);
          out(`MZT z_A+0,z_SP DEV z_SP`, `Push LSB argument ${argn} (${arg.exprs[0].$cstNode?.text})`);
          break;
        case "int*":
          throw new MinCompileError(`Cannot cast int* to int`, arg.exprs[0]);
        case "char*":
          throw new MinCompileError(`Cannot cast char* to int`, arg.exprs[0]);
        default:
          throw Error(`Unsupported argument type ${argType}`);
      }
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
  out(`JPS ${hexWord(node.address.value)}`, `Call statement to address ${node.address.value}`);
}
