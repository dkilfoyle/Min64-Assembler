import { osAddr } from "../oslabels";
import { MinCompileError, highOperand, lowOperand } from "../utils";
import * as expressionCompiler from "./expressions";
import { computeReachableDefs } from "../reachability";
import * as variableCompiler from "./variables";
import type { IVariableSymbol } from "./variables";
import {
  isCallStatement,
  isDef,
  isFunctionCall,
  isIf,
  isNumberLiteral,
  isPrintStatement,
  isReturnStatement,
  isStringLiteral,
  isUse,
  isVariableAssignment,
  isVariableCalcAssignment,
  isVariableDeclaration,
  isVariableReference,
  isWhile,
  LocalElement,
  PrintStatement,
  Program,
} from "../../ls/generated/ast";
import { compileDef, printFrame, compileCallStatement, compileReturn, compileFunctionCall } from "./functions";
import { compileIf, compileWhile } from "./controlflow";

export let assembly: string[] = [];
export let labelPrefixCounters: Map<string, number> = new Map();
export const osUsed: Set<string> = new Set();
export const runtimeUsed = new Set<string>();
export let currentFunction: string | null = null;
export let currentUri: string | undefined = undefined;
export const format = {
  indent: 0,
};

export const options = {
  printFrameStack: true,
  printFrame: true,
};

export const cached: { z_PTR: string; z_A: string } = {
  z_PTR: "",
  z_A: "",
};

export function reset() {
  labelPrefixCounters = new Map();
  assembly = [];
  osUsed.clear();
  runtimeUsed.clear();
  runtimeUsed.add("getPtr");
  runtimeUsed.add("signext");
  runtimeUsed.add("loadZA");
  runtimeUsed.add("storeZA");

  expressionCompiler.reset();
  variableCompiler.reset();
  currentFunction = null;
  format.indent = 0;

  cached.z_PTR = "";
  cached.z_A = "";
}

export function nextLabel(prefix: string): string {
  const n = (labelPrefixCounters.get(prefix) ?? 0) + 1;
  labelPrefixCounters.set(prefix, n);
  return `${prefix}${n}`;
}

export function os(name: string) {
  if (!osAddr[name]) throw Error("Unknown osCall " + name);
  osUsed.add(name);
  return name;
}

export function out(instruction: string, comment: string = "") {
  const x = `${" ".repeat(format.indent)}${comment ? `${instruction.padEnd(40 - format.indent)}; ${comment}` : instruction}`;
  assembly.push(x);
}

export function isCachedPtr(name: string): boolean {
  if (cached.z_PTR === name) return true;
  else {
    cached.z_PTR = name;
    return false;
  }
}

export function isCachedA(name: string): boolean {
  return false;
  // if (name == "") {
  //   // new z_A value is uncacheable, so reset the cache
  //   cached.z_A = "";
  //   return false;
  // }
  // if (cached.z_A === name) return true;
  // else {
  //   cached.z_A = name;
  //   return false;
  // }
}

export function compile(fname: string, mainProgram: Program, libraries: Program[]): string {
  reset();

  out(`; Code compiled from ${fname}\n`);
  out("#org 0x0100");

  currentUri = mainProgram.$document?.uri.toString();

  compileMain(mainProgram);

  const reachableDefs = computeReachableDefs(mainProgram, libraries);
  for (const def of reachableDefs) {
    currentUri = def.$document?.uri.toString();
    compileDef(def);
  }

  expressionCompiler.emitRuntime();
  expressionCompiler.emitHeader();
  emitOsCalls();
  return assembly.join("\n");
}

export function compileMain(mainProgram: Program) {
  // Main program body: everything except Def/Use at top level.
  variableCompiler.frameStack.push({
    name: "__global",
    kind: "global",
    variables: new Map<string, IVariableSymbol>(),
    frameSize: 0,
  });

  out(`__main:`);
  format.indent += 2;
  for (const el of mainProgram.elements) {
    if (isDef(el) || isUse(el)) continue;
    compileStatement(el);
  }
  const globalFrame = variableCompiler.currentFrame();
  printFrame(globalFrame);
  out(`\nJPA ${os("_Prompt")}`);
  format.indent -= 2;
}

export function compileStatement(node: LocalElement) {
  out(`; ${node.$cstNode?.text.split("\n")[0]}`);
  switch (true) {
    case isVariableDeclaration(node):
      return variableCompiler.compileVariableDeclaration(node);
    case isVariableCalcAssignment(node):
      return variableCompiler.compileVariableCalcAssignment(node);
    case isVariableAssignment(node):
      return variableCompiler.compileVariableAssignment(node);
    case isPrintStatement(node):
      return compilePrint(node);
    case isCallStatement(node):
      return compileCallStatement(node);
    case isReturnStatement(node):
      return compileReturn(node);
    case isIf(node):
      return compileIf(node);
    case isWhile(node):
      return compileWhile(node);
    case isFunctionCall(node):
      return compileFunctionCall(node);
    default:
      throw new MinCompileError("Unknown compilation type " + node.$type, node);
  }
}

export function compilePrint(print: PrintStatement) {
  out("; " + print.$cstNode?.text);
  print.args.forEach((arg, i) => {
    arg.exprs.forEach((expr, j) => {
      if (isNumberLiteral(expr) || isStringLiteral(expr)) {
        out(`JPS ${os("_Print")} "${expr.value}", 0`, "_Print");
        return;
      }
      if (isVariableReference(expr)) {
        const varName = expr.varName.$refText;
        const v = variableCompiler.getSymbol(varName, expr).symbolInfo;
        if (v.type == "char") {
          // print 0 terminated char(s)
          out(`LDI ${lowOperand(v.address)} PHS LDI ${highOperand(v.address)} PHS JPS ${os("_PrintPtr")} PLS PLS`, `print ${varName}`);

          return;
        }
      }
      expressionCompiler.compileExpression(expr);
      // result will be int in z_A
      out(`JPS __inttostr`);
      out(`LDB __strptr+0 PHS LDB __strptr+1 PHS JPS ${os("_PrintPtr")} PLS PLS`);
      runtimeUsed.add("__inttostr");
    });
  });
}

export function emitOsCalls() {
  out(`; MinOS API`);
  osUsed.forEach((name) => {
    const addr = osAddr[name];
    if (!addr) throw new Error(`Unknown os call ${name}`);
    out(`#org 0x${addr.toString(16).padStart(4, "0")} ${name}:`);
  });
}
