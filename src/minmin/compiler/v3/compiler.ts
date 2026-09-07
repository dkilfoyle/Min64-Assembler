import type { AstNode } from "langium";
import * as AST from "../../ls/generated/ast";
import { osAddr } from "../oslabels";
import {
  CompileError,
  hexByte,
  hexWord,
  highOperand,
  lowOperand,
} from "../utils";
import { ExpressionCompiler } from "./expressionCompiler";
import { computeReachableDefs } from "../reachability";
import {
  VariableCompiler,
  type IStackFrame,
  type IVariableSymbol,
} from "./variableCompiler";

export class MinCompiler {
  assembly: string[] = [];
  labelPrefixCounters: Map<string, number> = new Map();
  osUsed: Set<string> = new Set();
  runtimeUsed = new Set<string>();
  expressionCompiler = new ExpressionCompiler(this);
  variableCompiler = new VariableCompiler(this);
  currentFunction: string | null = null;

  // functions: Map<string, IFunctionInfo> = new Map();
  cached: {
    z_PTR: string;
    z_A: string;
  } = {
    z_PTR: "",
    z_A: "",
  };

  constructor() {
    this.reset();
  }

  reset() {
    this.labelPrefixCounters = new Map();
    this.assembly = [];
    this.osUsed.clear();
    this.runtimeUsed.clear();
    this.runtimeUsed.add("__getPtr");
    this.runtimeUsed.add("__loadZA");
    this.runtimeUsed.add("__storeZA");

    this.expressionCompiler.reset();
    this.variableCompiler.reset();
    this.currentFunction = null;

    // this.functions = new Map();
    this.cached.z_PTR = "";
    this.cached.z_A = "";
  }

  nextLabel(prefix: string): string {
    const n = (this.labelPrefixCounters.get(prefix) ?? 0) + 1;
    this.labelPrefixCounters.set(prefix, n);
    return `${prefix}${n}`;
  }

  os(name: string) {
    if (!osAddr[name]) throw Error("Unknown osCall " + name);
    this.osUsed.add(name);
    return name;
  }

  out(instruction: string, comment: string = "") {
    this.assembly.push(
      comment ? `${instruction.padEnd(40)}; ${comment}` : instruction,
    );
  }

  outi(instruction: string, comment: string = "") {
    this.assembly.push(
      comment ? `  ${instruction.padEnd(38)}; ${comment}` : "  " + instruction,
    );
  }

  isCachedPtr(name: string): boolean {
    if (this.cached.z_PTR === name) return true;
    else {
      this.cached.z_PTR = name;
      return false;
    }
  }

  isCachedA(name: string): boolean {
    if (this.cached.z_A === name) return true;
    else {
      this.cached.z_A = name;
      return false;
    }
  }

  compile(
    fname: string,
    mainProgram: AST.Program,
    libraries: AST.Program[],
  ): string {
    this.reset();

    this.out(`; Code compiled from ${fname}\n`);
    this.out("#org 0x0100");

    this.compileMain(mainProgram);

    const reachableDefs = computeReachableDefs(mainProgram, libraries);
    for (const def of reachableDefs) {
      this.compileDef(def);
    }

    this.expressionCompiler.emitRuntime();
    this.expressionCompiler.emitHeader();
    this.emitOsCalls();
    return this.assembly.join("\n");
  }

  compileMain(mainProgram: AST.Program) {
    // Main program body: everything except Def/Use at top level.
    this.variableCompiler.frameStack.push({
      name: "__global",
      kind: "global",
      variables: new Map<string, IVariableSymbol>(),
      frameSize: 0,
    });
    this.out(`__main:`);
    for (const el of mainProgram.elements) {
      if (AST.isDef(el) || AST.isUse(el)) continue;
      this.compileStatement(el);
    }
    const poppedFrame = this.variableCompiler.frameStack.pop()!;
    this.printFrame(poppedFrame);
    this.outi(`\nJPA ${this.os("_Prompt")}`);
  }

  emitOsCalls() {
    this.out(`; MinOS API`);
    this.osUsed.forEach((name) => {
      const addr = osAddr[name];
      if (!addr) throw new Error(`Unknown os call ${name}`);
      this.out(`#org 0x${addr.toString(16).padStart(4, "0")} ${name}:`);
    });
  }

  compileStatement(node: AST.LocalElement) {
    this.outi(`; ${node.$cstNode?.text}`);
    switch (true) {
      case AST.isVariableDeclaration(node):
        return this.variableCompiler.compileVariableDeclaration(node);
      case AST.isVariableCalcAssignment(node):
        return this.variableCompiler.compileVariableCalcAssignment(node);
      case AST.isPrintStatement(node):
        return this.compilePrint(node);
      case AST.isCallStatement(node):
        return this.compileCallStatement(node);
      case AST.isReturnStatement(node):
        console.error(`${node.$type} compilation not implemented`);
        // this.compile(node.value); // Leaves return evaluation scalar payload in Register A
        this.out("RTS", "Return from function subroutine, output stored in A");
        break;
      // case isExpression(node):
      //   console.error(`${node.$type} compilation not implemented`);
      //   this.compileExpression(node);
      //   break;
      case AST.isIf(node):
        console.error(`${node.$type} compilation not implemented`);
        const labelId = this.nextLabel("If");
        const elseLabel = `IF_ELSE_${labelId}`;
        const endLabel = `IF_END_${labelId}`;
        // this.compile(node.condition); // Leaves condition evaluation result check in register A
        // this.emit(`BRZ ${node.elseBranch ? elseLabel : endLabel}`, "Branch out if condition returns zero false value state evaluation");
        // node.thenBranch.forEach((stmt) => this.compile(stmt));
        // if (node.elseBranch) {
        //   this.emit(`JMP ${endLabel}, "Skip past else execution sequence path"`);
        //   this.emit(`${elseLabel}:`, "Else branch processing start block trace routing execution");
        //   node.elseBranch.forEach((stmt) => this.compile(stmt));
        // }
        // this.emit(`${endLabel}:`, "Reconverging structural pipeline resolution marker frame");
        break;
      case AST.isWhile(node): {
        console.error(`${node.$type} compilation not implemented`);
        // const labelId = this.labelCounter++;
        // const startLabel = `WHILE_START_${labelId}`;
        // const endLabel = `WHILE_END_${labelId}`;
        // this.emit(`${startLabel}:`, "While processing condition check pipeline safety loops entry");
        // this.compile(node.condition);
        // this.emit(`BRZ ${endLabel}, "Break processing context bounds loop path checks"`);
        // node.body.forEach((stmt) => this.compile(stmt));
        // this.emit(`JMP ${startLabel}`, "Recurse check sequence conditions iteratively inside execution spaces");
        // this.emit(`${endLabel}:`, "Resolution pipeline validation boundary processing terminal markers");
        break;
      }
      case AST.isFunctionCall(node):
        return this.compileFunctionCall(node);
      default:
        debugger;
        console.error("Unknown compilation type " + node.$type);
        throw Error("Unknown compilation type " + node.$type);
    }
  }

  /** a function call statement ie  foo(arg1, arg2) with no or ignored return value */
  compileFunctionCall(e: AST.FunctionCall) {
    const functionName = e.functionName.$refText;

    // push the arguments into the callee's frame
    e.args.forEach((arg, i) => {
      this.expressionCompiler.compileExpression(arg.exprs[0]); // result -> z_A
      const offset = this.variableCompiler.currentFrame().frameSize + i * 2;
      this.outi(
        `MVV z_FP,z_PTR AIV ${offset},z_PTR JPS __sdZA`,
        `copy z_A to ${functionName} arg${i}`,
      );
    });

    // make z_FP  -= this.variableCompiler.currentFrame().frameSize which will point to the new stack frame base
    this.outi(
      `SIV ${this.variableCompiler.currentFrame().frameSize},z_FP`,
      `z_FP = ${functionName}`,
    );

    this.outi(
      `JPS ${functionName}`,
      `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`,
    );

    // return value convention: callee leaves result in __A
  }

  compileDef(def: AST.Def) {
    this.currentFunction = def.name;
    this.out("\n");
    this.out(
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
    this.variableCompiler.frameStack.push(frame);

    def.block.forEach((stmt) => this.compileStatement(stmt));
    const poppedFrame = this.variableCompiler.frameStack.pop()!;
    this.outi(
      `AIV ${poppedFrame.frameSize},z_FP`,
      `Pop the current frame off stack`,
    );
    this.printFrame(poppedFrame);

    // Explicit backup fallback return sequence if execution flows off end of scope block
    if (this.assembly.at(-1)?.includes("RTS") == false) {
      this.outi(`RTS`, `return void`);
    }
  }

  compileBlock(name: string, stmts: AST.LocalElement[]) {
    const lastFrame = this.variableCompiler.frameStack.at(-1)!;
    const frame: IStackFrame = {
      name: name,
      kind: "block",
      frameSize: 0,
      variables: new Map(),
    };
    this.variableCompiler.frameStack.push(frame);
    this.outi(`SIV ${lastFrame.frameSize},z_FP`, `z_FP = ${name}`);
    stmts.forEach((stmt) => this.compileStatement(stmt));
    const poppedFrame = this.variableCompiler.frameStack.pop();
    if (poppedFrame) {
      this.printFrame(poppedFrame);
    }
    this.outi(`AIV ${frame.frameSize},z_FP`, `Pop the current frame off stack`);
  }

  printFrame(frame: IStackFrame) {
    this.out(`  ; frame summary`);
    frame.variables.forEach((v) =>
      this.out(`  ; ${v.name.padEnd(20)} : ${v.address}`),
    );
  }

  compileCallStatement(node: AST.CallStatement) {
    this.outi(
      `JPS ${hexWord(node.address.value)}`,
      `Call statement to address ${node.address.value}`,
    );
  }

  compilePrint(print: AST.PrintStatement) {
    this.outi("; " + print.$cstNode?.text);
    print.args.forEach((arg, i) => {
      arg.exprs.forEach((expr, j) => {
        if (AST.isNumberLiteral(expr) || AST.isStringLiteral(expr)) {
          this.outi(`JPS ${this.os("_Print")} "${expr.value}", 0`, "_Print");
          return;
        }
        if (AST.isVariableReference(expr)) {
          const varName = expr.varName.$refText;
          const v = this.variableCompiler.getSymbol(varName, expr).symbolInfo;
          if (v.type == "char") {
            // print 0 terminated char(s)
            this.outi(
              `LDI ${lowOperand(v.address)} PHS LDI ${highOperand(v.address)} PHS JPS ${this.os("_PrintPtr")} PLS PLS`,
              `print ${varName}`,
            );

            return;
          }
        }
        this.expressionCompiler.compileExpression(expr);
        // result will be int in z_A
        this.outi(`JPS __inttostr`);
        this.outi(
          `LDB __strptr+0 PHS LDB __strptr+1 PHS JPS ${this.os("_PrintPtr")} PLS PLS`,
        );
        this.runtimeUsed.add("__inttostr");
      });
    });
  }
}

export const minCompiler = new MinCompiler();
