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
import type { ScopeSymbol } from "./interface";
import { isDef } from "../../ls/generated/ast";
import { computeReachableDefs } from "../reachability";

interface IVariableSymbol {
  name: string;
  kind: "param" | "local";
  type: "int" | "char";
  count: number;
  address: number; // offset in the case of location=stack
  location: "stack" | "zeroPage" | "global" | "heap";
}

interface IStackFrame {
  name: string;
  variables: Map<string, IVariableSymbol>;
  frameSize: number;
}

interface IFunctionInfo {
  name: string;
  parameters: IVariableSymbol[];
}

export class MinCompiler {
  assembly: string[] = [];
  labelPrefixCounters: Map<string, number> = new Map();
  osUsed: Set<string> = new Set();
  runtimeUsed = new Set<string>();
  expressionCompiler = new ExpressionCompiler(this);
  currentFunction: string | null = null;
  frameStack: IStackFrame[] = [];
  functions: Map<string, IFunctionInfo> = new Map();
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
    this.expressionCompiler.reset();
    this.currentFunction = null;
    this.frameStack = [];
    this.functions = new Map();
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
      comment ? `${instruction.padEnd(38)}; ${comment}` : instruction,
    );
  }

  outi(instruction: string, comment: string = "") {
    this.assembly.push(
      comment ? `  ${instruction.padEnd(38)}; ${comment}` : "  " + instruction,
    );
  }

  getSymbol(name: string, node?: AstNode): IVariableSymbol {
    const frame = this.currentFrame(node);
    if (!frame)
      throw new CompileError(
        `Current function ${this.currentFunction} not found`,
        {} as AstNode,
      );
    const symbolInfo = frame.variables.get(name);
    if (!symbolInfo)
      throw new CompileError(
        `Symbol ${name} not found in function ${this.currentFunction}`,
        {} as AstNode,
      );
    return symbolInfo;
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
    this.frameStack.push({
      name: "__global",
      variables: new Map<string, IVariableSymbol>(),
      frameSize: 0,
    });

    const reachableDefs = computeReachableDefs(mainProgram, libraries);
    for (const def of reachableDefs) {
      let address = 0;
      this.functions.set(def.name, {
        name: def.name,
        parameters: def.params.map((p, i) => {
          const res: IVariableSymbol = {
            name: p.name,
            kind: "param",
            type: p.type,
            address: address,
            count: 1,
            location: "stack",
          };
          address -= p.type == "int" ? 2 : 1;
          return res;
        }),
      });
    }

    for (const el of mainProgram.elements) {
      if (AST.isDef(el) || AST.isUse(el)) continue;
      this.compileStatement(el);
    }

    for (const def of reachableDefs) {
      this.compileDef(def);
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

  currentFrame(node?: AstNode): IStackFrame {
    const frame = this.frameStack.at(-1);
    if (!frame)
      throw new CompileError("No current stack frame", node || ({} as AstNode));
    return frame;
  }

  /** z_PTR = &VarOnStack */
  emitGetPtr(varName: string) {
    const symbolInfo = this.getSymbol(varName);

    if (symbolInfo.location === "stack") {
      if (this.cached.z_PTR == varName) return;
      this.out(
        `MVV z_FP,z_PTR ${symbolInfo.address != 0 ? `SIV ${symbolInfo.address},z_PTR` : ""}`,
        `z_PTR = &${varName} (stack offset ${symbolInfo.address})`,
      );
      this.cached.z_PTR = varName;
    } else if (symbolInfo.location === "zeroPage") {
      throw new CompileError(
        `Symbol ${varName} is zeroPage, not in stack`,
        {} as AstNode,
      );
    }
  }

  emitCopyZIntoVar(sourceZ: string, varName: string) {
    const v = this.getSymbol(varName);
    if (v.location === "stack") {
      this.emitGetPtr(varName);
      this.out(
        `MTZ z_PTR,${sourceZ}+1 DEV z_PTR`,
        `MSB ${sourceZ} -> ${varName} (offset ${v.address})`,
      );
      this.out(
        `MTZ z_PTR,${sourceZ}+0 INV z_PTR`,
        `LSB ${sourceZ} -> ${varName} (offset ${v.address + 1})`,
      );
      return;
    } else if (v.location === "zeroPage") {
      this.out(
        `MVV ${sourceZ},${hexByte(v.address)}`,
        `${varName} from ${sourceZ} -> zeroPage`,
      );
      return;
    } else if (v.location === "global") {
      this.out(
        `MWV ${sourceZ},${hexWord(v.address)}`,
        `${varName} from ${sourceZ} -> global`,
      );
      return;
    }
    throw new CompileError(
      `Unsupported location for variable ${varName}`,
      {} as AstNode,
    );
  }

  /** z_PTR = &VarOnStack z_A/B = **z_PTR */
  emitCopyVarIntoZ(varName: string, targetAddr: number | string) {
    const v = this.getSymbol(varName);
    if (v.location === "stack" && this.cached.z_A == varName) return;

    if (typeof targetAddr === "number" && targetAddr > 0xff)
      throw new CompileError(
        `Target address ${targetAddr} is not zero-page`,
        {} as AstNode,
      );
    if (
      typeof targetAddr === "string" &&
      ["z_A", "z_B", "z_C", "z_D"].includes(targetAddr) == false
    )
      throw new CompileError(
        `Target address ${targetAddr} is not a valid z target`,
        {} as AstNode,
      );
    const targetLSB =
      typeof targetAddr === "number"
        ? hexByte((targetAddr + 0) & 0xff)
        : `${targetAddr}+0`;
    const targetMSB =
      typeof targetAddr === "number"
        ? hexByte((targetAddr + 1) & 0xff)
        : `${targetAddr}+1`;

    if (v.type === "int") {
      switch (v.location) {
        case "stack":
          this.emitGetPtr(varName); // z_PTR = &varName
          this.out(
            `MTZ z_PTR,${targetMSB} DEV z_PTR`,
            `MSB ${varName} -> ${targetMSB}`,
          );
          this.out(
            `MTZ z_PTR,${targetLSB} INV z_PTR`,
            `LSB ${varName} -> ${targetLSB}`,
          );
          this.cached.z_A = varName;
          return;
        case "zeroPage":
          this.out(
            `MVV ${hexByte(v.address)},${targetLSB}`,
            `${varName} from zeroPage -> ${targetAddr}`,
          );
          return;
        case "global":
          this.out(
            `MWV ${hexWord(v.address)},${targetLSB}`,
            `${varName} from global -> ${targetAddr}`,
          );
          return;
      }
    } else {
      switch (v.location) {
        case "stack":
          this.emitGetPtr(varName); // z_PTR = &varName
          this.out(
            `MTZ z_PTR,${targetLSB} JPS sign_ext`,
            `${varName} from stack -> ${targetAddr}`,
          );
          return;
        case "zeroPage":
          this.out(
            `MZZ ${hexByte(v.address)},${targetLSB} JPS __signext`,
            `${varName} from zeroPage -> ${targetAddr}`,
          );
          return;
        case "global":
          this.out(
            `MBZ ${hexWord(v.address)},${targetLSB} JPS __signext`,
            `${varName} from global -> ${targetAddr}`,
          );
          return;
      }
    }
  }

  compileVariableDeclaration(node: AST.VariableDeclaration) {
    const frame = this.currentFrame(node);
    const varName = node.name;

    const symbolInfo: IVariableSymbol = {
      name: node.name,
      kind: "local",
      type: node.type,
      count: 1, // Assuming single variable for now; extend for arrays if needed
      location: "stack",
      address: frame.frameSize,
    };
    frame.variables.set(varName, symbolInfo);
    frame.frameSize += node.type == "int" ? 2 : 1; // Assuming each variable takes 1 unit of frame size

    if (node.assignExpr) {
      debugger;
      this.expressionCompiler.compileExpression(node.assignExpr.exprs[0]); // z_A = result of expression
      this.emitCopyZIntoVar("z_A", varName);
    }
  }

  compileVariableCalcAssignment(node: AST.VariableCalcAssignment) {
    if (node.value == 0) return;
    const frame = this.currentFrame(node);
    const varName = node.varName.$refText;
    const symbolInfo = frame.variables.get(varName);
    if (!symbolInfo) {
      throw new CompileError(
        `Variable ${varName} not found in current scope`,
        node,
      );
    }

    this.emitCopyVarIntoZ(varName, "z_A"); // z_PTR = &varName

    if (node.op === "+=") {
      if (symbolInfo.type === "int") {
        if (node.value <= 0xff) {
          this.out(
            `LDI ${hexByte(node.value)} ADV z_A`,
            `${node.varName} += ${node.value}`,
          );
        } else {
          this.out(
            `LDI ${hexByte(node.value & 0xff)} ADV z_A LDI ${hexByte(node.value >> 8)} AD.Z z_A+1`,
            `${node.varName} += ${node.value}`,
          );
        }
        this.cached.z_A = "";
        this.emitCopyZIntoVar("z_A", varName);
      } else {
        this.out(
          `LDI ${hexByte(node.value)} AD.T z_PTR `,
          `${node.varName} += ${node.value}`,
        );
      }
    } else {
      if (symbolInfo.type === "int") {
        this.out(`; how to do this? check min.asm`);
      } else {
        this.out(
          `LDI ${hexByte(node.value)} SU.T z_PTR `,
          `${node.varName} += ${node.value}`,
        );
      }
    }
  }

  compileStatement(node: AST.LocalElement) {
    this.out("", node.$cstNode?.text);
    switch (true) {
      case AST.isVariableDeclaration(node):
        return this.compileVariableDeclaration(node);
      case AST.isVariableCalcAssignment(node):
        return this.compileVariableCalcAssignment(node);
        break;
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
        console.error("Unknown compilation type " + node.$type);
        throw Error("Unknown compilation type " + node.$type);
    }
  }

  compileDef(def: AST.Def) {
    this.currentFunction = def.name;
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

  compileFunctionCall(call: AST.FunctionCall) {
    const funcName = call.functionName.$refText;
    const frame = this.currentFrame();
    // Push arguments onto the virtual stack frame backwards (Right-to-Left pattern)
    for (let i = call.args.length - 1; i >= 0; i--) {
      this.expressionCompiler.compileExpression(call.args[i].exprs[0]); // Result ends up in z_A
      throw new CompileError(
        `Function call argument compilation not fully implemented for ${funcName}`,
        call,
      ); // TODO emitPushZToVirtualStack
      this.out(
        `LDZ z_A+1 PHS`,
        `Push MSB of arg ${i} (${call.args[i].exprs[0].$cstNode?.text})`,
      );
      this.out(
        `LDZ z_A+0 PHS`,
        `Push LSB of arg ${i} (${call.args[i].exprs[0].$cstNode?.text})`,
      );
    }
    this.out(`JPS fn_${funcName}`); // leave def prologue to tear down the args put on stack
    return;
  }

  compileCallStatement(node: AST.CallStatement) {
    this.out(
      `JPS ${hexWord(node.address.value)}`,
      `Call statement to address ${node.address.value}`,
    );
  }

  compilePrint(print: AST.PrintStatement) {
    this.out("; " + print.$cstNode?.text);
    print.args.forEach((arg, i) => {
      arg.exprs.forEach((expr, j) => {
        if (AST.isNumberLiteral(expr) || AST.isStringLiteral(expr)) {
          this.out(`JPS ${this.os("_Print")} "${expr.value}", 0`, "_Print");
          return;
        }
        if (AST.isVariableReference(expr)) {
          const varName = expr.varName.$refText;
          const v = this.getSymbol(varName, expr);
          if (v.type == "char") {
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
