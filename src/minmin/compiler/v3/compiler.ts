import { osAddr } from "../oslabels";
import { CompileError, highOperand, lowOperand } from "../utils";
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
import {
  compileDef,
  printFrame,
  compileCallStatement,
  compileReturn,
  compileFunctionCall,
} from "./functions";
import { compileIf, compileWhile } from "./controlflow";

export let assembly: string[] = [];
export let labelPrefixCounters: Map<string, number> = new Map();
export const osUsed: Set<string> = new Set();
export const runtimeUsed = new Set<string>();
export let currentFunction: string | null = null;
export let currentUri: string | undefined = undefined;

export const cached: { z_PTR: string; z_A: string } = {
  z_PTR: "",
  z_A: "",
};

export function reset() {
  labelPrefixCounters = new Map();
  assembly = [];
  osUsed.clear();
  runtimeUsed.clear();
  runtimeUsed.add("__getPtr");
  runtimeUsed.add("__loadZA");
  runtimeUsed.add("__storeZA");

  expressionCompiler.reset();
  variableCompiler.reset();
  currentFunction = null;

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
  assembly.push(
    comment ? `${instruction.padEnd(40)}; ${comment}` : instruction,
  );
}

export function outi(instruction: string, comment: string = "") {
  assembly.push(
    comment ? `  ${instruction.padEnd(38)}; ${comment}` : "  " + instruction,
  );
}

export function isCachedPtr(name: string): boolean {
  if (cached.z_PTR === name) return true;
  else {
    cached.z_PTR = name;
    return false;
  }
}

export function isCachedA(name: string): boolean {
  if (cached.z_A === name) return true;
  else {
    cached.z_A = name;
    return false;
  }
}

export function compile(
  fname: string,
  mainProgram: Program,
  libraries: Program[],
): string {
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
  for (const el of mainProgram.elements) {
    if (isDef(el) || isUse(el)) continue;
    compileStatement(el);
  }
  const poppedFrame = variableCompiler.frameStack.pop()!;
  printFrame(poppedFrame);
  outi(`\nJPA ${os("_Prompt")}`);
}

export function compileStatement(node: LocalElement) {
  outi(`; ${node.$cstNode?.text}`);
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
      throw new CompileError("Unknown compilation type " + node.$type, node);
  }
}

export function compilePrint(print: PrintStatement) {
  outi("; " + print.$cstNode?.text);
  print.args.forEach((arg, i) => {
    arg.exprs.forEach((expr, j) => {
      if (isNumberLiteral(expr) || isStringLiteral(expr)) {
        outi(`JPS ${os("_Print")} "${expr.value}", 0`, "_Print");
        return;
      }
      if (isVariableReference(expr)) {
        const varName = expr.varName.$refText;
        const v = variableCompiler.getSymbol(varName, expr).symbolInfo;
        if (v.type == "char") {
          // print 0 terminated char(s)
          outi(
            `LDI ${lowOperand(v.address)} PHS LDI ${highOperand(v.address)} PHS JPS ${os("_PrintPtr")} PLS PLS`,
            `print ${varName}`,
          );

          return;
        }
      }
      expressionCompiler.compileExpression(expr);
      // result will be int in z_A
      outi(`JPS __inttostr`);
      outi(
        `LDB __strptr+0 PHS LDB __strptr+1 PHS JPS ${os("_PrintPtr")} PLS PLS`,
      );
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
