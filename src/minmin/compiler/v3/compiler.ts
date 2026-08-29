import type { AstNode } from "langium";
import * as AST from "../../ls/generated/ast";
import { osAddr } from "../oslabels";
import { highOperand, lowOperand } from "../utils";
import { ExpressionCompiler } from "./expressionCompiler";
import type { ScopeSymbol } from "./interface";
import { isDef } from "../../ls/generated/ast";
import { computeReachableDefs } from "../reachability";
import { resolveImportUri } from "../../ls/minmin-import-utils";

export class MinCompiler {
  assembly: string[] = [];
  labelPrefixCounters: Map<string, number> = new Map();
  scopeStack: Map<string, ScopeSymbol>[] = [];
  osUsed: Set<string> = new Set();
  expressionCompiler: ExpressionCompiler;
  runtimeUsed = new Set<string>();
  public stdLib: AST.Program | null = null;

  constructor() {
    this.expressionCompiler = new ExpressionCompiler(this);
    this.reset();
  }

  reset() {
    this.labelPrefixCounters = new Map();
    this.assembly = [];
    this.scopeStack = [];
    this.osUsed.clear();
    this.runtimeUsed.clear();
    this.expressionCompiler.reset();
  }

  getSymbolInfo(name: string) {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const frame = this.scopeStack[i];
      const s = frame.get(name);
      if (s) return s;
    }
    throw new Error(`${name} is not a defined symbol`);
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
      comment ? `${instruction.padEnd(38)}; ${comment}` : instruction,
    );
  }
  compile(
    fname: string,
    mainProgram: AST.Program,
    libraries: AST.Program[],
  ): string {
    this.reset();

    this.out(`; Code compiled from ${fname}\n`);
    this.out("#org 0x0100");

    // Main program body: everything except Def/Use at top level.
    for (const el of mainProgram.elements) {
      if (AST.isDef(el) || AST.isUse(el)) continue;
      this.emitStatement(el);
    }

    const reachableDefs = computeReachableDefs(mainProgram, libraries);
    for (const def of reachableDefs) {
      this.emitDef(def);
    }

    this.out(`JPA ${this.os("_Prompt")}`);
    this.expressionCompiler.emitRuntime();
    this.expressionCompiler.emitHeader();
    this.emitOsCalls();
    return this.assembly.join("\n");
  }

  emitOsCalls() {
    this.out(`; MinOS API`);
    this.osUsed.forEach((name) => {
      const addr = osAddr[name];
      if (!addr) throw new Error(`Unknown os call ${name}`);
      this.out(`#org 0x${addr.toString(16).padStart(4, "0")} ${name}:`);
    });
  }

  emitStatement(node: AstNode) {
    switch (true) {
      case AST.isProgram(node):
        node.elements.forEach((stmt) => this.emitStatement(stmt));
        break;
      case AST.isPrintStatement(node):
        this.emitPrint(node);
        break;

      case AST.isCallStatement(node):
        console.error(`${node.$type} compilation not implemented`);
        // Push standard execution arguments onto the stack frame backwards (Right-to-Left pattern)
        // for (let i = node.args.length - 1; i >= 0; i--) {
        //   this.compile(node.args[i]); // Result ends up in Accumulator A
        //   this.emit(`"PHA", Push frame call argument parameter index [${i}]`);
        // }
        // this.emit(`JSR fn_${node.name}, Jump to Subroutine function address 'fn_${node.name}'`);
        // // Result of function evaluation is preserved dynamically in Register A
        break;
      case AST.isReturnStatement(node):
        console.error(`${node.$type} compilation not implemented`);
        // this.compile(node.value); // Leaves return evaluation scalar payload in Register A
        this.out("RTS", "Return from function subroutine, output stored in A");
        break;
      case AST.isVariableAssignment(node):
        console.error(`${node.$type} compilation not implemented`);
        // this.compile(node.value);
        // const zpAddr = this.getZpAddress(node.name);
        // this.emit(`STZ ${zpAddr}, Store accumulator directly into variable mapping '${node.name}'`);
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
        console.error(`${node.$type} compilation not implemented`);
        break;
      default:
        console.error("Unknown compilation type " + node.$type);
        throw Error("Unknown compilation type " + node.$type);
    }
  }

  emitDef(def: AST.Def) {
    this.out(
      `\nfn_${def.name}:`,
      `Declaration entry for function "${def.name}"`,
    );
    // Pull parameters off the stack frame in reverse order they were pushed
    // Store parameters into quick hardware Zero-Page locations allocated for this scope
    // for (let i = 0; i < node.params.length; i++) {
    //   const paramName = `${node.name}_local_${node.params[i]}`;
    //   const targetZp = this.getZpAddress(paramName);
    //   this.emit("PLA", "Pull call parameter argument off stack");
    // }
    // node.body.forEach((stmt) => this.compile(stmt));
    // // Explicit backup fallback return sequence if execution flows off end of scope block
    // this.emit(`"RTS", Default return safety fallback path for ${node.name}`);
  }

  emitPrint(print: AST.PrintStatement) {
    this.out("; " + print.$cstNode?.text);
    print.args.forEach((arg, i) => {
      arg.exprs.forEach((expr, j) => {
        if (AST.isNumberLiteral(expr) || AST.isStringLiteral(expr)) {
          this.out(`JPS ${this.os("_Print")} "${expr.value}", 0`, "_Print");
          return;
        }
        if (AST.isVariableReference(expr)) {
          const varName = expr.varName.$refText;
          const v = this.getSymbolInfo(varName);
          if (v.kind == "variable" && v.type == "char") {
            // print 0 terminated char(s)
            this.out(
              `PHS ${lowOperand(v.address)} PHS ${highOperand(v.address)} JPS ${this.os("_PrintPtr")} PLS PLS`,
              `print ${varName}`,
            );

            return;
          }
        }
        this.expressionCompiler.compileExpression(expr);
        // result will be int in z_A
        this.out(`JPS __inttostr`);
        this.out(
          `LDB __strptr+0 PHS LDB __strptr+1 PHS JPS ${this.os("_PrintPtr")} PLS PLS`,
        );
        this.runtimeUsed.add("__inttostr");
      });
    });
  }
}

export const minCompiler = new MinCompiler();
