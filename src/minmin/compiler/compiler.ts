import type { AstNode } from "langium";
import {
  isCallStatement,
  isConstExpression,
  isDef,
  isIf,
  isPrintStatement,
  isProgram,
  isReturnStatement,
  isVariableAssignment,
  isWhile,
  PrintStatement,
  type Program,
} from "../ls/generated/ast";
import { osAddr } from "./oslabels";
import { highOperand, lowOperand } from "./utils";
import { ExpressionCompiler } from "./expressions";

interface ScopeSymbol {
  kind: "variable" | "function";
}

export interface VariableSymbol extends ScopeSymbol {
  kind: "variable";
  address: number;
  type: "int" | "byte";
  count: number;
}

export interface FunctionSymbol extends ScopeSymbol {
  kind: "function";
  addr: number;
}

// zero-page map
// 00..3d - named
// 3e..5d - word temps growing down
// 5e..7e - byte temps growing down

export class MinCompiler {
  assembly: string[] = [];

  labelPrefixCounters: Map<string, number> = new Map();
  scopeStack: Map<string, VariableSymbol | FunctionSymbol>[] = [];

  expressionCompiler: ExpressionCompiler;

  constructor() {
    this.expressionCompiler = new ExpressionCompiler(this);
    this.reset();
  }

  reset() {
    this.labelPrefixCounters = new Map();
    this.assembly = [];
    this.scopeStack = [];
  }

  getSymbolInfo(name: string) {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const frame = this.scopeStack[i];
      const s = frame.get(name);
      if (s) return s;
    }
    return undefined;
  }

  nextLabel(prefix: string): string {
    const n = (this.labelPrefixCounters.get(prefix) ?? 0) + 1;
    this.labelPrefixCounters.set(prefix, n);
    return `${prefix}${n}`;
  }

  osCall(name: string) {
    if (!osAddr[name]) throw Error("Unknown osCall " + name);
    this.symbols.globals.set(name, osAddr[name]);
    return name;
  }

  out(instruction: string, comment: string = "") {
    this.assembly.push(comment ? `${instruction.padEnd(38)}; ${comment}` : instruction);
  }

  generate(fname: string, program: Program): string {
    this.reset();
    this.out(`; Code compiled from ${fname}\n`);
    this.compile(program);
    this.out(`\n; Globals`);
    this.symbols.globals.forEach((addr, name) => this.out(`#org 0x${addr.toString(16).padStart(4, "0")} ${name}:`));
    return this.assembly.join("\n");
  }

  emitPrint(print: PrintStatement) {
    this.out("; " + print.$cstNode?.text);
    print.args.forEach((arg, i) => {
      arg.exprs.forEach((expr, j) => {
        if (isConstExpression(expr)) {
          this.out(`JPS ${this.osCall("_Print")} "${expr.value}", 0`, "_Print");
        } else {
          const { width, loc } = this.expressionCompiler.compileExpression(expr);
          if (width == "byte") this.out(`JPS ${this.osCall("_PrintHex")}`);
          else {
            this.out(`; print result @ ${lowOperand(loc?.addr!)}`);
            this.out(`PHS ${lowOperand(loc?.addr!)}`);
            this.out(`PHS ${highOperand(loc?.addr!)}`);
            this.out(`JPS ${this.osCall("_PrintPtr")}`);
            this.expressionCompiler.freeLoc(loc!);
          }
        }
      });
    });
  }

  compile(node: AstNode) {
    switch (true) {
      case isProgram(node):
        node.elements.forEach((stmt) => this.compile(stmt));
        break;
      case isPrintStatement(node):
        this.emitPrint(node);
        break;
      case isDef(node):
        console.error(`${node.$type} compilation not implemented`);
        this.out(`\nfn_${node.name}:, Declaration entry for function "${node.name}"`);
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
        break;
      case isCallStatement(node):
        console.error(`${node.$type} compilation not implemented`);
        // Push standard execution arguments onto the stack frame backwards (Right-to-Left pattern)
        // for (let i = node.args.length - 1; i >= 0; i--) {
        //   this.compile(node.args[i]); // Result ends up in Accumulator A
        //   this.emit(`"PHA", Push frame call argument parameter index [${i}]`);
        // }
        // this.emit(`JSR fn_${node.name}, Jump to Subroutine function address 'fn_${node.name}'`);
        // // Result of function evaluation is preserved dynamically in Register A
        break;
      case isReturnStatement(node):
        console.error(`${node.$type} compilation not implemented`);
        // this.compile(node.value); // Leaves return evaluation scalar payload in Register A
        this.out("RTS", "Return from function subroutine, output stored in A");
        break;
      case isVariableAssignment(node):
        console.error(`${node.$type} compilation not implemented`);
        // this.compile(node.value);
        // const zpAddr = this.getZpAddress(node.name);
        // this.emit(`STZ ${zpAddr}, Store accumulator directly into variable mapping '${node.name}'`);
        break;
      // case isExpression(node):
      //   console.error(`${node.$type} compilation not implemented`);
      //   this.compileExpression(node);
      //   break;
      case isIf(node):
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
      case isWhile(node): {
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
      default:
        throw Error("Unknown compilation type " + node.$type);
    }
  }
}

export const minCompiler = new MinCompiler();

// ### Architectural Updates Explained

// 1. **The Function Pipeline Framework (`JSR` / `RTS`):** When calling a function expression block `addNumbers(target, 12)`, our compiler generates `JSR` (Jump to Subroutine). The architecture shifts the current runtime context counter safely out onto the stack segment before shifting parsing controls. The subroutine terminates on encountering a `RTS` (Return from Subroutine) instruction, instantly realigning the system frame.
// 2. **Reverse Order Dynamic Argument Extraction (`PLA`):** Because variables get compiled from right-to-left onto the stack space before executing the jumping routines, arguments are exposed in proper sequential order. On arriving within `fn_addNumbers`, the initialization compiler pulls sequentially via `PLA` into localized fast Zero-Page memory addresses, allowing clean local scoping via names like `addNumbers_local_x`.
// 3. **If-Else Binary Routing Strategy:** The compiler checks the status register directly via `BRZ` (Branch if Zero) after generating your conditional expression loop checks. If evaluating `false`, code execution jumps past the standard container block using localized markers like `IF_ELSE_0`.

// If you would like to expand this compiler even further, let me know:
// * Do you want to add **nested expression support** to `if` conditions (like logical `&&` or comparisons like `==`)?
// * Should the compiler track **local variable lifetimes** so that multiple different function calls can safely reuse the exact same Zero-Page RAM slots?

// [1] [https://users.dcc.uchile.cl](https://users.dcc.uchile.cl/~etanter/CC5116/lec_function-calls_notes.html)
// [2] [https://opendylan.org](https://opendylan.org/hacker-guide/runtime/calling-convention.html)
// [3] [https://levelup.gitconnected.com](https://levelup.gitconnected.com/x86-calling-conventions-a34812afe097)
// [4] [https://icarus.cs.weber.edu](https://icarus.cs.weber.edu/~dab/cs1410/textbook/6.Functions/scope.html)
// [5] [https://www.freecodecamp.org](https://www.freecodecamp.org/news/how-javascript-lint-rules-work-and-why-abstract-syntax-trees-matter/)
// [6] [https://pkg.go.dev](https://pkg.go.dev/go.starlark.net/syntax)
