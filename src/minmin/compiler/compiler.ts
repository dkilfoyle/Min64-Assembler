import type { AstNode } from "langium";
import {
  Expression,
  isBinaryExpression,
  isCallStatement,
  isConstExpression,
  isDef,
  isExpression,
  isFunctionCall,
  isIf,
  isNumberLiteral,
  isPrintStatement,
  isProgram,
  isReturnStatement,
  isStringLiteral,
  isUnaryExpression,
  isVariableAssignment,
  isVariableReference,
  isWhile,
  PrintStatement,
  type Program,
} from "../ls/generated/ast";
import { osAddr } from "./oslabels";

const hex8 = (x: number) => `0x${x.toString(16).padStart(2, "0")}`;
const hex16 = (x: number) => `0x${x.toString(16).padStart(4, "0")}`;

class MinCompiler {
  assembly: string[] = [];
  zpMap = new Map<string, string>();
  zpCursor = 0x50;
  labelCounter = 0;
  osUsed = new Set<string>();

  reset() {
    this.osUsed = new Set();
    this.zpMap = new Map();
    this.assembly = [];
    this.zpCursor = 0x50;
    this.zpMap.set("z_BC", hex8(this.zpCursor));
    this.zpMap.set("z_B", hex8(this.zpCursor++));
    this.zpMap.set("z_C", hex8(this.zpCursor++));
    this.zpMap.set("z_DE", hex8(this.zpCursor));
    this.zpMap.set("z_D", hex8(this.zpCursor++));
    this.zpMap.set("z_E", hex8(this.zpCursor++));
  }

  addZpByte(name: string) {
    if (!this.zpMap.has(name)) {
      this.zpMap.set(name, hex8(this.zpCursor++));
    }
  }

  addZpWord(name: string) {
    if (!this.zpMap.has(name)) {
      this.zpMap.set(name, hex16((this.zpCursor += 2)));
    }
  }

  getZpByte(name: string): string {
    this.addZpByte(name);
    return this.zpMap.get(name)!;
  }

  getZpWord(name: string): string {
    this.addZpWord(name);
    return this.zpMap.get(name)!;
  }

  osCall(name: string) {
    this.osUsed.add(name);
    return name;
  }

  emit(instruction: string, comment: string = "") {
    this.assembly.push(comment ? `${instruction.padEnd(18)}; ${comment}` : instruction);
  }

  generate(fname: string, program: Program): string {
    this.reset();
    this.emit(`; Code compiled from ${fname}`);
    this.compile(program);
    this.emit(`; MinOS`);
    this.osUsed.forEach((o) => this.emit(`#org ${osAddr[o]} ${o}:`));

    return this.assembly.join("\n");
  }

  compilePrint(print: PrintStatement) {
    print.args.forEach((arg, i) => {
      arg.exprs.forEach((expr, j) => {
        if (isConstExpression(expr)) {
          this.emit(`JSR ${this.osCall("_Print")} "${expr.value}", 0`, "_Print");
        } else {
          this.compileExpression(expr);
        }
      });
    });
  }

  compileExpression(expr: Expression) {
    switch (true) {
      case isBinaryExpression(expr):
        console.error(`${expr.$type} compilation not implemented`);
        this.compileExpression(expr.right);
        this.emit("PHA", "Store right side operand expression onto hardware stack tracking");
        this.compileExpression(expr.left);
        if (expr.operator === "+") {
          this.emit("ADD_STACK", "Add top stack workspace allocation variable to Accumulator A");
        } else {
          this.emit("SUB_STACK", "Subtract stack value element allocation directly away from Accumulator A");
        }
        break;
      case isUnaryExpression(expr):
        console.error(`${expr.$type} compilation not implemented`);
        break;
      case isNumberLiteral(expr):
        console.error(`${expr.$type} compilation not implemented`);
        this.emit(`LDI ${expr.value}, Load intermediate numerical integer literal value directly`);
        break;
      case isStringLiteral(expr):
        console.error(`${expr.$type} compilation not implemented`);
        // this.emit(`LDI ${expr.value}, Load intermediate numerical integer literal value directly`);
        break;
      case isVariableReference(expr):
        console.error(`${expr.$type} compilation not implemented`);
        // Look up global tracking reference mappings or locally localized scope tags
        // Check if a localized instance mapping configuration exists for tracking
        // let targetLookup = node.name;
        // // Basic scope lookup: check if it matches an active variable tracking footprint
        // for (const key of this.zeroPageMap.keys()) {
        //   if (key.endsWith(`_local_${node.name}`)) {
        //     targetLookup = key;
        //     break;
        //   }
        // }
        // const addr = this.getZpAddress(targetLookup);
        // this.emit(`LDZ ${addr}, Load tracking variable entry '${node.name}' out from Zero-Page`);
        break;
      case isFunctionCall(expr):
        console.error(`${expr.$type} compilation not implemented`);
        break;
      default:
        throw Error("Unknown expr type ");
    }
  }

  compile(node: AstNode) {
    switch (true) {
      case isProgram(node):
        node.elements.forEach((stmt) => this.compile(stmt));
        break;
      case isPrintStatement(node):
        this.compilePrint(node);
        break;
      case isDef(node):
        console.error(`${node.$type} compilation not implemented`);
        this.emit(`\nfn_${node.name}:, Declaration entry for function "${node.name}"`);
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
        this.emit("RTS", "Return from function subroutine, output stored in A");
        break;
      case isVariableAssignment(node):
        console.error(`${node.$type} compilation not implemented`);
        // this.compile(node.value);
        // const zpAddr = this.getZpAddress(node.name);
        // this.emit(`STZ ${zpAddr}, Store accumulator directly into variable mapping '${node.name}'`);
        break;
      case isExpression(node):
        console.error(`${node.$type} compilation not implemented`);
        this.compileExpression(node);
        break;
      case isIf(node):
        console.error(`${node.$type} compilation not implemented`);
        const labelId = this.labelCounter++;
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
