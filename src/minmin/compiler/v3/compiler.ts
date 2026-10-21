import { osAddr } from "../oslabels";
import { MinCompileError, hexWord, highOperand, lowOperand } from "../utils";
import * as expressionCompiler from "./expressions";
import { computeReachableDefs } from "../reachability";
import * as variableCompiler from "./variables";
import type { IExpressionType } from "./variables";
import {
  Expression,
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
  compileCallStatement,
  compileReturn,
  compileFunctionCall,
} from "./functions";
import { compileIf, compileWhile } from "./controlflow";
import { ZP_BASE } from "./expressions";
import { frameStack } from "./stack";

const runtimeGlob = import.meta.glob("../runtime/*.asm", {
  query: "?raw",
  import: "default",
  eager: true,
});

const runtime = Object.fromEntries(
  Object.entries(runtimeGlob).map(([path, definition]) => {
    // Extract file name without extension to use as the new key
    const fileName =
      "__" + path.slice(path.lastIndexOf("/") + 1).replace(".asm", "");
    return [fileName, definition];
  }),
);

export let assembly: string[] = [];
export let labelPrefixCounters: Map<string, number> = new Map();
export const osUsed: Set<string> = new Set();
export const runtimeUsed = new Set<string>();
export let currentUri: string | undefined = undefined;
export const format = {
  indent: 0,
};

export const options = {
  printFrameStack: true,
  printFrame: true,
};

interface ICachedValue {
  id: string;
  type: IExpressionType;
}

export const cached: {
  z_PTR: ICachedValue;
  z_A: ICachedValue;
  blockPath: string;
} = {
  z_PTR: { id: "", type: "int" },
  z_A: { id: "", type: "int" },
  blockPath: "",
};

export function emitRuntimeCall(name: string, comment?: string) {
  const definition = runtime[`__${name}`];
  if (!definition)
    throw new MinCompileError(
      `Runtime definition not found for ${name}`,
      {} as any,
    );
  runtimeUsed.add(name);
  out(`JPS __${name}`, comment);
}

export function emitZeroPage() {
  out("");
  out(`; ---- Compiler zero-page working storage ----`);
  out(`#org ${hexWord(ZP_BASE)}`);
  out(`z_FP:     0xEFFF    ; frame start pointer`);
  out(`z_SP:     0xEFFF    ; top of stack pointer`);
  out(`z_PTR:    0x0000    ; ptr to current var in runtime stack`);
  out(`z_HP:     0x8000    ; heap pointer`);
  out(`z_A:      0x0000    ; acc / expr result / fn return value`);
  out(`z_B:      0x0000    ; secondary operand`);
  out(`z_C:      0x0000    ; scratch (mul/div/cmp)`);
  out(`z_D:      0x0000    ; scratch (div quotient)`);
  out(`z_PTR2:   0x0000    ; secondary pointer for array operations`);
  out(`z_TMP1:   0x0000    ; temporary storage`);
  out(`z_TMP2:   0x0000    ; temporary storage`);
  out(`z_cnt:    0x00      ; loop counter (mul/div/shifts)`);
  out(`z_flag:   0x00      ; sign flag (div)`);
  out(`z_CNT:    0x0000    ; array slice count`);
  out(``);
}

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
  frameStack.reset();
  format.indent = 0;

  cached.z_PTR = { id: "", type: "int" };
  cached.z_A = { id: "", type: "int" };
  cached.blockPath = "";
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
  if (cached.z_PTR.id === name) return true;
  else {
    cached.z_PTR = { id: name, type: "int" };
    return false;
  }
}

export function isCachedZA(e: Expression): boolean {
  const ename = e.$cstNode ? `${cached.blockPath}.${e.$cstNode.text}` : "";

  if (ename == "") {
    // new z_A value is uncacheable, so reset the cache
    cached.z_A = { id: "", type: "int" };
    return false;
  }
  if (cached.z_A.id === ename) return true;
  else {
    cached.z_A = { id: ename, type: "int" };
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

  emitRuntime();
  emitZeroPage();
  emitOsCalls();
  return assembly.join("\n");
}

export function compileMain(mainProgram: Program) {
  // Main program body: everything except Def/Use at top level.
  const frame = frameStack.addFrame("__global", "global");

  out(`__main:`);
  format.indent += 2;
  for (const el of mainProgram.elements) {
    if (isDef(el) || isUse(el)) continue;
    compileStatement(el);
  }
  frameStack.printFrame();
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
  print.args.forEach((arg, i) => {
    arg.exprs.forEach((expr, j) => {
      if (isNumberLiteral(expr) || isStringLiteral(expr)) {
        out(`JPS ${os("_Print")} "${expr.value}", 0`, "_Print");
        return;
      }
      if (isVariableReference(expr)) {
        const varName = expr.varName.$refText;
        const v = frameStack.getVariable(varName, expr).varInfo;
        if (v.type == "char") {
          // print 0 terminated char(s)
          out(
            `LDI ${lowOperand(v.address)} PHS LDI ${highOperand(v.address)} PHS`,
            `push &${varName}`,
          );
          out(`JPS ${os("_PrintPtr")} PLS PLS`, `print ${varName}`);
          return;
        }
      }
      expressionCompiler.compileExpression(expr);
      // result will be int in z_A
      emitRuntimeCall(`inttostr`);
      out(`LDB __strptr+0 PHS LDB __strptr+1 PHS`, `print int`);
      out(`JPS ${os("_PrintPtr")} PLS PLS`, `print int`);
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

export function emitRuntime() {
  out("");
  out(`; --- runtime library ---`);
  out(`#page`);
  out("");
  runtimeUsed.forEach((x) => {
    const code = runtime["__" + x];
    if (!code) {
      throw new Error(`Unable to find runtime code for ${x}`);
    }
    code
      .split("\n")
      .filter((line) => line.trim() !== "")
      .forEach((line) => out(line));
    out("");
  });
}
