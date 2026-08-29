import type { AstNode } from "langium";
import * as AST from "../../ls/generated/ast";
import {
  isBinaryExpression,
  isComparisonExpression,
  isUnaryExpression,
  isVariableReference,
  isNumberLiteral,
  isStringLiteral,
  isFunctionCall,
  isIf,
  isWhile,
  isDef,
  isUse,
  isBreakStatement,
  isCallStatement,
  isPrintStatement,
  isReturnStatement,
  isVariableCalcAssignment,
  isVariableAssignment,
  isVariableDeclaration,
} from "../../ls/generated/ast";
import { CompileError } from "../utils";
import { computeReachableDefs } from "../reachability";

/**
 * Code generator: MIN AST -> Minimal 64x4 assembly text (fed to assembler.ts).
 *
 * === v1 scope and memory model ===
 *
 * All user variables (globals AND function locals/parameters) are allocated in ZERO PAGE,
 * bump-allocated at compile time starting at ZP_USER_BASE. This lets every variable access
 * use the efficient 'zp' (1-byte address) addressing family throughout (ADV/SUV/CIV/etc for
 * int, ADZ/SUZ/CPZ/etc for char) with no separate absolute-addressing code path needed.
 *
 * Function locals/parameters are STATIC, not stack-allocated: each function gets a fixed
 * zero-page region reused on every call. This means MIN's true (dynamically-stack-allocated,
 * runtime-length) string/reference semantics are NOT implemented - recursion is not
 * supported, and a `char` parameter/local is a FIXED 1-byte scalar, not an arbitrary-length
 * string. This comfortably covers programs built from scalar/fixed-array arithmetic
 * (the dots/lines/rects/fill examples); genuine dynamic strings and concatenation (`_`,
 * needed by blocks.min) are not yet implemented and produce a clear compile error.
 *
 * CODE lives at CODE_BASE (0x2000). "call <addr>" and print() int-conversion glue live in a
 * small runtime support block emitted once per program.
 */

// Zero-page layout:
//   0x00-0x0f  compiler-internal expression temps (RESULT/LHS/RHS/PTR1/etc - see below)
//   0x10-0x7f  user variables (globals + static/non-reentrant locals) - 112 bytes
//   0x80-0xff  RESERVED by the OS (PtrA-F, Z0-Z5, _XPos/_YPos, xa/ya/dx/dy/etc - see the
//              manual's OS API table / os.asm's "#org 0x0080" zero-page section) - a
//              compiled MIN program must never write here unless deliberately calling
//              into an OS routine that expects it.
const ZP_USER_BASE = 0x10;
const ZP_USER_END = 0x80; // exclusive - OS-reserved territory starts here
const CODE_BASE = 0x2000;

// Fixed OS API entry points (see manual.txt's documented OS API table, cross-checked
// against os.asm's actual implementations).
const OS_CLEAR = 0xf033;
const OS_PRINTCHAR = 0xf042; // A = char to print
const OS_PRINT = 0xf045; // prints a zero-terminated string IMMEDIATELY TRAILING the call
const OS_PRINTPTR = 0xf048; // prints a zero-terminated string at an address (pushed via PHS)

interface IFrameVar {
  name: string; // funcName or funcName_blockName
  type: VarType;
  address: { type: "fp" | "abs"; value: number }; // zero-page address (of element 0, for arrays)
  isArray: boolean;
  length: number; // element count (1 for scalars)
}

interface IStackFrame {
  locals: Map<string, VarInfo>;
  breakLabel: string | null; // for `break` inside while loops
  returnLabel: string | null; // for `return` inside functions
  continueLabel: string | null; // for `continue` inside while loops
  parent: IStackFrame | null; // for nested scopes
  function: FuncInfo | null; // the function this stack frame belongs to
}

// function call or enter new block
// create a new stackFrame
// calculate frameSize = total size of params and locals
// Save the parent frame pointer (fp) to the stack
// - temp = *fp + frameSize
// - *temp = *fp
// - *fp = *temp
// save each param = *fp + 2 + paramOffset
// allocate each local to the stack = *fp + 2 + paramSize + localOffset

type VarType = "int" | "char";

interface VarInfo {
  type: VarType;
  address: number; // zero-page address (of element 0, for arrays)
  isArray: boolean;
  length: number; // element count (1 for scalars)
  pinned: boolean; // "@" - address is a fixed external location, not compiler-allocated
}

interface FuncInfo {
  def: AST.Def;
  params: VarInfo[]; // in declaration order, matching def.params
  locals: Map<string, VarInfo>; // includes params, by name
  entryLabel: string;
  usedByRef: boolean[]; // per-param: true if declared with "&"
}

function elementSize(type: VarType): number {
  return type === "int" ? 2 : 1;
}

export class MinCompiler {
  private globals = new Map<string, VarInfo>();
  private functions = new Map<string, FuncInfo>();
  private zpNext = ZP_USER_BASE;
  private lines: string[] = [];
  private labelCounter = 0;
  private currentFunc: FuncInfo | null = null;
  private breakLabels: string[] = []; // stack, for `break` inside while loops

  compile(mainProgram: AST.Program, libraries: AST.Program[]): string {
    // Collect all Def elements from libraries + main program (main's own defs may also
    // shadow/extend library defs - last one wins if duplicated, matching simple linking).
    const allPrograms = [...libraries, mainProgram];
    for (const prog of allPrograms) {
      for (const el of prog.elements) {
        if (AST.isDef(el))
          this.functions.set(el.name, this.registerFunction(el));
      }
    }

    this.lines.push("#org " + hexWord(CODE_BASE));
    this.lines.push("__main_entry:");

    // Main program body: everything except Def/Use at top level.
    for (const el of mainProgram.elements) {
      if (AST.isDef(el) || AST.isUse(el)) continue;
      this.genStatement(el);
    }
    // __main_entry is the program's entry point (PC is set here directly at boot, not
    // reached via JPS), so it must NOT end with RTS - there is no return address on the
    // stack to pop, and doing so reads garbage and wild-jumps. Halt safely instead.
    const haltLabel = this.newLabel("halt");
    this.emitLabel(haltLabel);
    this.emit(`FPA ${haltLabel}`);

    // Emit only the functions actually reachable from main (simple reachability pass),
    // so unused library functions (e.g. std.min's string helpers, if unused) don't need
    // to compile successfully.
    const reachable = computeReachableDefs(mainProgram, libraries);
    for (const def of reachable) {
      const fn = this.functions.get(def.name);
      if (fn) this.genFunction(fn);
    }

    Object.entries(RESERVED_TEMPS).forEach(([name, addr]) => {
      this.emit("#org " + hexWord(addr) + "    " + name + ":");
    });

    return this.lines.join("\n") + "\n";
  }

  // ---------------------------------------------------------------------------------
  // Declaration / symbol table setup
  // ---------------------------------------------------------------------------------

  private registerFunction(def: AST.Def): FuncInfo {
    const entryLabel = `__fn_${def.name}`;
    const locals = new Map<string, VarInfo>();
    const params: VarInfo[] = [];
    const usedByRef: boolean[] = [];
    for (const p of def.params) {
      const info = this.allocVar(def, p.type, p.name, 1, false);
      locals.set(p.name, info);
      params.push(info);
      if (AST.isParameterDeclaration(p)) {
        usedByRef.push(p.byRef);
      }
    }
    return { def, params, locals, entryLabel, usedByRef };
  }

  /** Assign a range of zero-page memory for a variable and return address */
  private allocVar(
    node: AstNode,
    type: VarType,
    name: string,
    length: number,
    pinned: boolean,
    atAddr?: number,
  ): VarInfo {
    if (pinned) {
      return {
        type,
        address: atAddr!,
        isArray: length > 1,
        length,
        pinned: true,
      };
    }
    const size = elementSize(type) * length;
    if (this.zpNext + size > ZP_USER_END) {
      throw new CompileError(
        `out of zero-page space allocating '${name}' (${size} bytes needed, ` +
          `${ZP_USER_END - this.zpNext} available) - v1 only supports zero-page storage`,
        node,
      );
    }
    const address = this.zpNext;
    this.zpNext += size;
    return { type, address, isArray: length > 1, length, pinned: false };
  }

  private newLabel(prefix: string): string {
    return `__${prefix}_${this.labelCounter++}`;
  }

  private emit(line: string): void {
    this.lines.push("  " + line);
  }
  private emitLabel(label: string): void {
    this.lines.push(label + ":");
  }

  // ---------------------------------------------------------------------------------
  // Statements
  // ---------------------------------------------------------------------------------

  private genStatement(el: AST.GlobalElement): void {
    switch (true) {
      case AST.isVariableDeclaration(el):
        return this.genVariableDeclaration(el);
      case AST.isVariableAssignment(el):
        return this.genVariableAssignment(el);
      case AST.isVariableCalcAssignment(el):
        return this.genVariableCalcAssignment(el);
      case AST.isFunctionCall(el):
        this.genFunctionCall(el, null);
        return;
      case AST.isReturnStatement(el):
        return this.genReturn(el);
      case AST.isBreakStatement(el):
        return this.genBreak(el);
      case AST.isCallStatement(el):
        this.emit(`JPS ${hexWord(el.address.value)}`);
        return;
      case AST.isPrintStatement(el):
        return this.genPrint(el);
      case AST.isIf(el):
        return this.genIf(el);
      case AST.isWhile(el):
        return this.genWhile(el);
      case AST.isDef(el):
      case AST.isUse(el):
        return; // handled at top level
    }
  }

  private genVariableDeclaration(decl: AST.VariableDeclaration): void {
    // "type name = name[a|b]" is the array-size-declaration idiom: the RHS self-references
    // the variable being declared (which doesn't exist yet) purely to specify its length.
    let length = 1;
    let pinnedAddr: number | undefined;
    if (decl.atExpr) {
      pinnedAddr = this.constEval(decl.atExpr);
    }
    const selfSizeRef =
      decl.assignExpr &&
      decl.assignExpr.exprs.length === 1 &&
      isVariableReference(decl.assignExpr.exprs[0]) &&
      decl.assignExpr.exprs[0].varName.$refText === decl.name &&
      decl.assignExpr.exprs[0].index !== null; // of form type name = name[a|b]

    if (selfSizeRef) {
      const idx = (decl.assignExpr!.exprs[0] as AST.VariableReference).index!;
      const start = idx.startExpr ? this.constEval(idx.startExpr) : 0;
      const end = idx.endExpr ? this.constEval(idx.endExpr) : start;
      length = end - start + 1; // inclusive range, per fill.min's usage (a[0|24] -> 25 elems)
      if (length < 1)
        throw new CompileError(
          `invalid array size [${start}|${end}]`,
          decl.assignExpr!.exprs[0],
        );
    } else if (decl.atExpr) {
      // A pinned variable with no explicit size (e.g. "char d @ 0x0080") is a raw
      // memory-address overlay: index it freely, with no compiler-tracked bounds
      // (matching the interpreter's own convention of an unbounded max for pinned vars).
      length = 0xffff;
    }

    const info = this.allocVar(
      decl,
      decl.type,
      decl.name,
      length,
      !!decl.atExpr,
      pinnedAddr,
    );
    this.declareVar(decl.name, info);

    if (decl.assignExpr && !selfSizeRef) {
      this.genAssignInto(decl, info, null, decl.assignExpr);
    }
  }

  /** Add the static variable to either function locals or globals */

  private declareVar(name: string, info: VarInfo): void {
    if (this.currentFunc) this.currentFunc.locals.set(name, info);
    else this.globals.set(name, info);
  }

  private lookupVar(name: string, node: AstNode): VarInfo {
    if (this.currentFunc?.locals.has(name))
      return this.currentFunc.locals.get(name)!;
    if (this.globals.has(name)) return this.globals.get(name)!;
    throw new CompileError(`undefined variable '${name}'`, node);
  }

  private genVariableAssignment(stmt: AST.VariableAssignment): void {
    const info = this.lookupVar(stmt.varName?.$refText!, stmt);
    this.genAssignInto(stmt, info, stmt.indexExpr, stmt.assignExpr);
  }

  private genAssignInto(
    stmt: AstNode,
    lhsInfo: VarInfo,
    lhsIndexExpr: AST.Expression | undefined | null,
    rhs: AST.CompoundExpression,
  ): void {
    // generate x = rhs

    if (rhs.exprs.length > 1) {
      throw new CompileError(
        "concatenation (_) is not yet supported by this compiler",
        rhs,
      );
    }
    const rhsExpr = rhs.exprs[0];

    if (lhsIndexExpr) {
      // a[i] = expr : single element write
      if (!lhsInfo.isArray)
        throw new CompileError(
          `indexed assignment target is not an array`,
          lhsIndexExpr,
        );
      this.genEvalToTemp(rhsExpr, lhsInfo.type, "T1"); // T1 = rhs()
      this.genIndexAddressToPtr(lhsInfo, lhsIndexExpr, "PTR1"); // PTR1 = &(a[i])
      this.genStoreIndirect("PTR1", lhsInfo.type, "T1"); // **PTR1 = *T1
      return;
    }

    // Whole-variable assignment. Special case: assigning ANOTHER whole array (e.g.
    // "video[i] = a" is index+array-source; "b = a" is whole-array copy) - handled by
    // checking whether the source expression is itself an array variable reference.
    if (lhsInfo.isArray && isVariableReference(rhsExpr) && !rhsExpr.index) {
      const src = this.lookupVar(rhsExpr.varName.$refText, rhsExpr);
      if (src.isArray) {
        this.genArrayCopy(src, lhsInfo);
        return;
      }
    }
    if (lhsInfo.isArray) {
      throw new CompileError(
        `cannot assign a scalar expression to array '${lhsInfo.address}'`,
        stmt,
      );
    }
    this.genEvalToVar(rhsExpr, lhsInfo);
  }

  /** Copies the whole content of `src` array into `dst` array (dst[i] = src[i % src.length]
   *  is NOT implemented - lengths must be compatible; used for e.g. fill.min's video[i]=a
   *  pattern via a byte-for-byte copy of min(src bytes, dst-remaining bytes)). */
  private genArrayCopy(src: VarInfo, dst: VarInfo): void {
    const srcBytes = elementSize(src.type) * src.length;
    // dst here is the SPECIFIC destination location (already offset if this was an
    // indexed whole-array store); copy exactly srcBytes bytes.
    for (let i = 0; i < srcBytes; i++) {
      this.emit(`LDZ ${hexByte(src.address + i)}`);
      this.emit(`SDZ ${hexByte(dst.address + i)}`);
    }
  }

  private genVariableCalcAssignment(stmt: AST.VariableCalcAssignment): void {
    const lhsInfo = this.lookupVar(stmt.varName.$refText, stmt);
    const rhsValue = stmt.value;
    if (stmt.indexExpr) {
      this.genIndexAddressToPtr(lhsInfo, stmt.indexExpr, "PTR1"); // ptr1 holds address of lhs[i]
      // what value does a hold now after return from genIndexAddressToPtr
      this.emit(`LDI ${rhsValue & 0xff}`); // RegA = lsb(rhsValue)
      this.emit(`${stmt.op == "+=" ? "AD.T" : "SU.T"} PTR1+0`); // lhs[i] += RegA
      if (lhsInfo.type === "int") {
        this.emit(`LDI ${rhsValue >> 8}`); // RegA = msb(rhsValue)
        this.emit(`${stmt.op == "+=" ? "AD.T" : "SU.T"} PTR1+1`); // lhs[i] += RegA
      }
    } else {
      if (rhsValue & 0xff00)
        throw new CompileError(
          `rhsValue ${rhsValue} too large for byte assignment`,
          stmt,
        );
      if (lhsInfo.type === "int") {
        this.emit(
          `${stmt.op === "+=" ? "AIV" : "SIV"} ${rhsValue & 0xff},${hexWord(lhsInfo.address)}`,
        );
      } else {
        this.emit(
          `${stmt.op === "+=" ? "AIZ" : "SIZ"} ${rhsValue & 0xff},${hexWord(lhsInfo.address)}`,
        );
      }
      return;
    }
  }

  private genReturn(stmt: AST.ReturnStatement): void {
    if (!this.currentFunc)
      throw new CompileError("return outside function", stmt);
    if (stmt.expr.exprs.length > 1) {
      throw new CompileError(
        "concatenation (_) is not yet supported by this compiler",
        stmt,
      );
    }
    // Return value convention: leave result in A (char) or in the reserved __ret zero-page
    // word (int). Caller reads it from there immediately after the call.
    const expr = stmt.expr.exprs[0];
    const retType =
      this.currentFunc.def.params.length > 0 ? undefined : undefined; // unused
    this.genEvalGeneric(expr);
    this.emit("RTS");
  }

  private genBreak(stmt: AST.BreakStatement): void {
    if (this.breakLabels.length === 0)
      throw new CompileError("break outside while", stmt);
    this.emit(`FPA ${this.breakLabels[this.breakLabels.length - 1]}`);
  }

  private genIf(stmt: AST.If): void {
    const endLabel = this.newLabel("if_end");
    const chain: {
      condLabel: string | null;
      falseLabel: string;
      block: AST.GlobalElement[];
    }[] = [];

    const branches: {
      condition: AST.Expression;
      block: AST.GlobalElement[];
    }[] = [
      { condition: stmt.condition, block: stmt.block },
      ...stmt.elifs.map((e) => ({ condition: e.condition, block: e.block })),
    ];

    for (const branch of branches) {
      const falseLabel = this.newLabel("if_next");
      this.genConditionJumpIfFalse(branch.condition, falseLabel);
      for (const s of branch.block) this.genStatement(s);
      this.emit(`FPA ${endLabel}`);
      this.emitLabel(falseLabel);
    }
    if (stmt.elseBlock) {
      for (const s of stmt.elseBlock.block) this.genStatement(s);
    }
    this.emitLabel(endLabel);
  }

  private genWhile(stmt: AST.While): void {
    const startLabel = this.newLabel("while_start");
    const endLabel = this.newLabel("while_end");
    this.breakLabels.push(endLabel);
    this.emitLabel(startLabel);
    this.genConditionJumpIfFalse(stmt.condition, endLabel);
    for (const s of stmt.block) this.genStatement(s);
    this.emit(`FPA ${startLabel}`);
    this.emitLabel(endLabel);
    this.breakLabels.pop();
  }

  private genPrint(stmt: AST.PrintStatement): void {
    for (const compound of stmt.args) {
      if (compound.exprs.length > 1) {
        throw new CompileError(
          "concatenation (_) is not yet supported by this compiler",
          stmt,
        );
      }
      this.genPrintOne(compound.exprs[0]);
    }
  }

  private genPrintOne(expr: AST.Expression): void {
    // String literal: use _Print's "immediate string trails the call" convention directly
    // - simplest and matches how the OS itself prints constant text.
    if (AST.isStringLiteral(expr)) {
      this.emit(`JPS OS_PRINT`);
      this.emit(`'${escapeForAsmString(expr.value)}', 0`);
      return;
    }
    // A char-array/string VARIABLE reference (whole, no index): print via _PrintPtr,
    // passing its address. Requires the array to be null-terminated by convention (v1
    // limitation - not yet enforced by the compiler).
    if (AST.isVariableReference(expr) && !expr.index && !expr.isAddress) {
      const info = this.lookupVar(expr.varName.$refText, expr);
      if (info.type === "char" && info.isArray) {
        this.genCallPrintPtrLiteralAddr(info.address);
        return;
      }
    }
    // Otherwise: evaluate as a general expression. char -> _PrintChar (one character);
    // int -> convert to decimal and _PrintPtr.
    const type = this.inferType(expr);
    if (type === "char") {
      this.genEvalGeneric(expr);
      this.emit(`LDZ ${zp("RESULTC")}`);
      this.emit(`JPS OS_PRINTCHAR`);
      return;
    }
    this.genEvalGeneric(expr);
    this.genIntToDecimal();
    this.genCallPrintPtrFromZp(zp("NUMBUF"));
  }

  /** Best-effort static type inference for print()'s dispatch (char vs int). */
  private inferType(expr: AST.Expression): VarType {
    switch (true) {
      case AST.isVariableReference(expr):
        return this.lookupVar(expr.varName.$refText, expr).type;
      case AST.isNumberLiteral(expr):
        return "int";
      case AST.isUnaryExpression(expr):
        return this.inferType(expr.inner);
      case AST.isBinaryExpression(expr):
      case AST.isComparisonExpression(expr):
        return "int"; // arithmetic/comparison results are always treated as int in v1
      case AST.isFunctionCall(expr): {
        const fn = this.functions.get(expr.functionName.$refText);
        return fn?.def.block.length ? "int" : "int"; // v1: function returns treated as int
      }
      default:
        return "int";
    }
  }

  /** Calls _PrintPtr with a compile-time-KNOWN zero-page address (e.g. a fixed array). */
  private genCallPrintPtrLiteralAddr(zpAddress: number): void {
    this.emit(`LDI ${hexByte(zpAddress & 0xff)}`);
    this.emit(`PHS`);
    this.emit(`LDI 0x00`); // MSB of a zero-page address is always 0
    this.emit(`PHS`);
    this.emit(`JPS OS_PRINTPTR`);
    this.emit(`PLS`);
    this.emit(`PLS`);
  }

  /** Calls _PrintPtr with a 16-bit pointer already stored at the given zero-page word. */
  private genCallPrintPtrFromZp(ptrZp: string): void {
    this.emit(`LDZ ${ptrZp}`);
    this.emit(`PHS`);
    this.emit(`LDZ ${ptrZp}+1`);
    this.emit(`PHS`);
    this.emit(`JPS OS_PRINTPTR`);
    this.emit(`PLS`);
    this.emit(`PLS`);
  }

  /**
   * Converts the 16-bit unsigned value currently in RESULT to a null-terminated decimal
   * ASCII string in NUMBUF (up to 5 digits + null, fits the reserved 8-byte scratch area),
   * and leaves NUMBUF's address in RESULT (ready for genCallPrintPtrFromZp).
   *
   * Self-contained (doesn't depend on std.min's str(), which needs the deferred runtime
   * stack for its "&e-&s" length trick).
   */
  private genIntToDecimal(): void {
    const loopLabel = this.newLabel("itoa_loop");
    const lastByte = RESERVED_TEMPS.NUMBUF + 7;
    // Repeated divide-by-10, writing digits from the end of the buffer backward.
    this.emit(`MVV ${zp("RESULT")},${zp("LHS")}`); // LHS = remaining value to convert
    this.emit(`MIV ${hexByte(lastByte & 0xff)},${zp("PTR1")}`); // write cursor starts at the last byte
    this.emit(`MIT 0x00,${zp("PTR1")}`); // null terminator at the very end
    this.emitLabel(loopLabel);
    this.emit(`MIV 0x000a,${zp("RHS")}`); // divide by 10
    this.emitDivide(); // RESULT = LHS / 10 (quotient); DIVR left holding the remainder
    this.emit(`SIZ 1,${zp("PTR1")}`); // move write cursor back one byte
    this.emit(`AIZ 0x30,${zp("DIVR")}`); // digit = '0' + remainder
    this.emit(`LDZ ${zp("DIVR")}`);
    this.emit(`SDT ${zp("PTR1")}`); // write the digit
    this.emit(`MVV ${zp("RESULT")},${zp("LHS")}`); // LHS = quotient, for the next digit
    this.emit(`CIV 0x0000,${zp("LHS")}`);
    this.emit(`BNE ${loopLabel}`);
    this.emit(`MVV ${zp("PTR1")},${zp("RESULT")}`); // RESULT = address of the first digit
  }

  private genFunctionCall(
    call: AST.FunctionCall,
    resultVar: VarInfo | null,
  ): void {
    const fn = this.functions.get(call.functionName.$refText);
    if (!fn)
      throw new CompileError(
        `undefined function '${call.functionName.$refText}'`,
        call,
      );
    if (call.args.length !== fn.params.length) {
      throw new CompileError(
        `'${call.functionName.$refText}' expects ${fn.params.length} argument(s), got ${call.args.length}`,
        call,
      );
    }
    for (let i = 0; i < call.args.length; i++) {
      const argCompound = call.args[i];
      if (argCompound.exprs.length > 1) {
        throw new CompileError(
          "concatenation (_) is not yet supported by this compiler",
          call,
        );
      }
      const param = fn.params[i];
      if (fn.usedByRef[i]) {
        throw new CompileError(
          "by-reference parameters are not yet supported by this compiler",
          call,
        );
      }
      this.genEvalToVar(argCompound.exprs[0], param);
    }
    this.emit(`JPS ${fn.entryLabel}`);
  }

  // ---------------------------------------------------------------------------------
  // Functions
  // ---------------------------------------------------------------------------------

  private genFunction(fn: FuncInfo): void {
    this.currentFunc = fn;
    this.emitLabel(fn.entryLabel);
    for (const s of fn.def.block) this.genStatement(s);
    this.emit("RTS");
    this.currentFunc = null;
  }

  // ---------------------------------------------------------------------------------
  // Expression codegen
  // ---------------------------------------------------------------------------------

  /** Evaluates `expr` (must be int or char typed) and stores the result into `dest`. */
  private genEvalToVar(expr: AST.Expression, dest: VarInfo): void {
    if (dest.isArray)
      throw new CompileError(
        "cannot assign a scalar to an array variable",
        expr,
      );
    this.genEvalGeneric(expr);
    if (dest.type === "int") {
      this.emit(`MVV ${zp("RESULT")},${hexWord(dest.address)}`);
    } else {
      this.emit(`MZZ ${zp("RESULTC")},${hexWord(dest.address)}`);
    }
  }

  private genEvalToTemp(
    expr: AST.Expression,
    type: VarType,
    tempName: string,
  ): void {
    this.genEvalGeneric(expr);
    if (type === "int") this.emit(`MVV ${zp("RESULT")},${zp(tempName)}`);
    else this.emit(`MZZ ${zp("RESULTC")},${zp(tempName)}`);
  }

  /**
   * Evaluates any expression, leaving the result in the reserved RESULT (int, 2 bytes) or
   * RESULTC (char, 1 byte; also mirrored into A) zero-page location. This uniform
   * "spill to a fixed temp" strategy trades some performance for much simpler codegen,
   * appropriate for this compiler's scope.
   */
  private genEvalGeneric(expr: AST.Expression): void {
    switch (true) {
      case isNumberLiteral(expr):
        this.emit(`MIV ${hexWord(expr.value)},${zp("RESULT")}`);
        return;
      case isStringLiteral(expr):
        throw new CompileError(
          "string literals are not yet supported by this compiler",
          expr,
        );
      case isVariableReference(expr):
        return this.genEvalVariableReference(expr);
      case isFunctionCall(expr): {
        this.genFunctionCall(expr, null);
        this.emit(`MVV ${zp("RETVAL")},${zp("RESULT")}`);
        return;
      }
      case isUnaryExpression(expr):
        return this.genEvalUnary(expr);
      case isBinaryExpression(expr):
        return this.genEvalBinary(expr);
      case isComparisonExpression(expr):
        return this.genEvalComparison(expr);
    }
  }

  private genEvalVariableReference(ref: AST.VariableReference): void {
    if (ref.isAddress) {
      const info = this.lookupVar(ref.varName.$refText, ref.$container);
      this.emit(`MIV ${hexWord(info.address)},${zp("RESULT")}`);
      return;
    }
    const info = this.lookupVar(ref.varName.$refText, ref.$container);
    if (ref.index) {
      if (ref.index.endExpr) {
        throw new CompileError(
          "range slicing is not yet supported by this compiler",
          ref.index.endExpr,
        );
      }
      const startExpr = ref.index.startExpr;
      if (!startExpr)
        throw new CompileError("array reference needs an index", ref.index);
      this.genIndexAddressToPtr(info, startExpr, "PTR1");
      if (info.type === "int") {
        this.emit(`LDT ${zp("PTR1")}`);
        this.emit(`SDZ ${zp("RESULT")}`);
        this.emit(`INV ${zp("PTR1")}`);
        this.emit(`LDT ${zp("PTR1")}`);
        this.emit(`SDZ ${zp("RESULT")}+1`);
      } else {
        this.emit(`LDT ${zp("PTR1")}`);
        this.emit(`SDZ ${zp("RESULT")}`);
      }
      return;
    }
    if (info.type === "int") {
      this.emit(`MVV ${hexWord(info.address)},${zp("RESULT")}`);
    } else {
      this.emit(`MZZ ${hexByte(info.address)},${zp("RESULTC")}`);
      this.emit(`MZZ ${zp("RESULTC")},${zp("RESULT")}`); // zero-extend into RESULT low byte
      this.emit(`CLZ ${zp("RESULT")}+1`);
    }
  }

  /** Computes the runtime BYTE address of arr[indexExpr] into the given zero-page pointer. */
  private genIndexAddressToPtr(
    info: VarInfo,
    indexExpr: AST.Expression,
    ptrName: string,
  ): void {
    const esize = elementSize(info.type);
    this.genEvalGeneric(indexExpr); // index -> RESULT (int)
    if (esize === 2) {
      this.emit(`MVV ${zp("RESULT")},${zp(ptrName)}`);
      this.emit(`LLV ${zp(ptrName)}`); // *2 (element size 2)
    } else {
      this.emit(`MZZ ${zp("RESULT")},${zp(ptrName)}`);
      this.emit(`CLZ ${zp(ptrName)}+1`);
    }
    this.emit(`AIV ${hexWord(info.address)},${zp(ptrName)}`);
  }

  private genStoreIndirect(
    ptrName: string,
    type: VarType,
    tempName: string,
  ): void {
    if (type === "int") {
      this.emit(`LDZ ${zp(tempName)}`);
      this.emit(`SDT ${zp(ptrName)}`);
      this.emit(`INV ${zp(ptrName)}`);
      this.emit(`LDZ ${zp(tempName)}+1`);
      this.emit(`SDT ${zp(ptrName)}`);
    } else {
      this.emit(`LDZ ${zp(tempName)}`);
      this.emit(`SDT ${zp(ptrName)}`);
    }
  }

  private genEvalUnary(expr: AST.UnaryExpression): void {
    this.genEvalGeneric(expr.inner);
    if (expr.op === "-") {
      this.emit(`NEV ${zp("RESULT")}`);
    } else {
      // 'not': logical not -> 1 if zero, else 0
      const zeroLabel = this.newLabel("not_zero");
      const endLabel = this.newLabel("not_end");
      this.emit(`CIV 0x0000,${zp("RESULT")}`);
      this.emit(`BEQ ${zeroLabel}`);
      this.emit(`MIV 0x0000,${zp("RESULT")}`);
      this.emit(`FPA ${endLabel}`);
      this.emitLabel(zeroLabel);
      this.emit(`MIV 0x0001,${zp("RESULT")}`);
      this.emitLabel(endLabel);
    }
  }

  private genEvalBinary(expr: AST.BinaryExpression): void {
    this.genEvalGeneric(expr.left);
    this.emit(`MVV ${zp("RESULT")},${zp("LHS")}`);
    this.genEvalGeneric(expr.right);
    this.emit(`MVV ${zp("RESULT")},${zp("RHS")}`);
    switch (expr.op) {
      case "+":
        this.emit(`MVV ${zp("LHS")},${zp("RESULT")}`);
        this.emit(`AVV ${zp("RHS")},${zp("RESULT")}`);
        return;
      case "-":
        this.emit(`MVV ${zp("LHS")},${zp("RESULT")}`);
        this.emit(`SVV ${zp("RHS")},${zp("RESULT")}`);
        return;
      case "*":
        this.emitMultiply();
        return;
      case "/":
        this.emitDivide();
        return;
      case "and":
        this.emitBitwise("AND");
        return;
      case "or":
        this.emitBitwise("OR");
        return;
      case "xor":
        this.emitBitwise("XOR");
        return;
      case "<<":
      case ">>":
        this.emitShift(expr.op, expr);
        return;
    }
  }

  private emitBitwise(op: "AND" | "OR" | "XOR"): void {
    // byte-wise AND/OR/XOR across both bytes of the 16-bit LHS/RHS temps.
    const mnem = op === "AND" ? "ANZ" : op === "OR" ? "ORZ" : "XRZ";
    for (const suffix of ["", "+1"]) {
      this.emit(`LDZ ${zp("LHS")}${suffix}`);
      this.emit(`${mnem} ${zp("RHS")}${suffix}`);
      this.emit(`SDZ ${zp("RESULT")}${suffix}`);
    }
  }

  private emitShift(op: "<<" | ">>", node: AstNode): void {
    // Only constant small shift amounts are supported in v1 (compile-time loop unroll of
    // runtime shift-by-1, using the RHS value as a runtime loop count).
    const loopLabel = this.newLabel("shift_loop");
    const endLabel = this.newLabel("shift_end");
    this.emit(`MVV ${zp("LHS")},${zp("RESULT")}`);
    this.emitLabel(loopLabel);
    this.emit(`CIV 0x0000,${zp("RHS")}`);
    this.emit(`BEQ ${endLabel}`);
    this.emit(op === "<<" ? `LLV ${zp("RESULT")}` : `RRZ ${zp("RESULT")}+1`);
    if (op === ">>") this.emit(`RRZ ${zp("RESULT")}`); // approximate logical right shift
    this.emit(`SIV 1,${zp("RHS")}`);
    this.emit(`FPA ${loopLabel}`);
    this.emitLabel(endLabel);
  }

  private emitMultiply(): void {
    // Simple runtime shift-add multiply: RESULT = LHS * RHS (16-bit).
    const loopLabel = this.newLabel("mul_loop");
    const skipLabel = this.newLabel("mul_skip");
    const endLabel = this.newLabel("mul_end");
    this.emit(`MIV 0x0000,${zp("RESULT")}`);
    this.emit(`MIV 0x0010,${zp("MULN")}`); // 16 iterations
    this.emitLabel(loopLabel);
    this.emit(`CIV 0x0000,${zp("MULN")}`);
    this.emit(`BEQ ${endLabel}`);
    this.emit(`LDZ ${zp("RHS")}`);
    this.emit(`ANI 0x01`);
    this.emit(`CPI 0x00`);
    this.emit(`BEQ ${skipLabel}`);
    this.emit(`AVV ${zp("LHS")},${zp("RESULT")}`);
    this.emitLabel(skipLabel);
    this.emit(`LLV ${zp("LHS")}`);
    this.emit(`RRZ ${zp("RHS")}+1`);
    this.emit(`RRZ ${zp("RHS")}`);
    this.emit(`SIV 1,${zp("MULN")}`);
    this.emit(`FPA ${loopLabel}`);
    this.emitLabel(endLabel);
  }

  private emitDivide(): void {
    // Simple runtime restoring-division: RESULT = LHS / RHS (16-bit, unsigned).
    const loopLabel = this.newLabel("div_loop");
    const skipLabel = this.newLabel("div_skip");
    const endLabel = this.newLabel("div_end");
    this.emit(`MIV 0x0000,${zp("DIVQ")}`); // quotient
    this.emit(`MIV 0x0000,${zp("DIVR")}`); // remainder
    this.emit(`MIV 0x0010,${zp("MULN")}`); // bit counter
    this.emitLabel(loopLabel);
    this.emit(`CIV 0x0000,${zp("MULN")}`);
    this.emit(`BEQ ${endLabel}`);
    this.emit(`LLV ${zp("DIVR")}`);
    this.emit(`LDZ ${zp("LHS")}+1`);
    this.emit(`ANI 0x80`);
    this.emit(`CPI 0x00`);
    this.emit(`BEQ ${skipLabel}`);
    this.emit(`AIV 1,${zp("DIVR")}`);
    this.emitLabel(skipLabel);
    this.emit(`LLV ${zp("LHS")}`);
    this.emit(`LLV ${zp("DIVQ")}`);
    this.emit(`CVV ${zp("RHS")},${zp("DIVR")}`);
    this.emit(`BCC ${loopLabel}`); // DIVR < RHS: no subtract this round (unsigned compare via BCC after CVV... )
    this.emit(`SVV ${zp("RHS")},${zp("DIVR")}`);
    this.emit(`AIV 1,${zp("DIVQ")}`);
    this.emit(`FPA ${loopLabel}`);
    this.emitLabel(endLabel);
    this.emit(`MVV ${zp("DIVQ")},${zp("RESULT")}`);
  }

  private genEvalComparison(expr: AST.ComparisonExpression): void {
    this.genEvalGeneric(expr.left);
    this.emit(`MVV ${zp("RESULT")},${zp("LHS")}`);
    this.genEvalGeneric(expr.right);
    this.emit(`MVV ${zp("RESULT")},${zp("RHS")}`);
    const trueLabel = this.newLabel("cmp_true");
    const endLabel = this.newLabel("cmp_end");
    this.emit(`CVV ${zp("RHS")},${zp("LHS")}`);
    const branchMap: Record<AST.ComparisonExpression["op"], string> = {
      "<": "BCC",
      "<=": "BLE",
      ">": "BGT",
      ">=": "BCS",
      "==": "BEQ",
      "!=": "BNE",
    };
    this.emit(`${branchMap[expr.op]} ${trueLabel}`);
    this.emit(`MIV 0x0000,${zp("RESULT")}`);
    this.emit(`FPA ${endLabel}`);
    this.emitLabel(trueLabel);
    this.emit(`MIV 0x0001,${zp("RESULT")}`);
    this.emitLabel(endLabel);
  }

  /** Evaluates a boolean expression and jumps to `falseLabel` if it's zero (false). */
  private genConditionJumpIfFalse(
    expr: AST.Expression,
    falseLabel: string,
  ): void {
    this.genEvalGeneric(expr);
    this.emit(`CIV 0x0000,${zp("RESULT")}`);
    this.emit(`BEQ ${falseLabel}`);
  }

  /** Evaluates a constant (compile-time) expression - used for array sizes and @ addresses. */
  private constEval(expr: AST.Expression): number {
    switch (true) {
      case isNumberLiteral(expr):
        return expr.value;
      case isUnaryExpression(expr):
        if (expr.op === "-") return -this.constEval(expr.inner);
        throw new CompileError("unsupported constant expression", expr);
      case isBinaryExpression(expr): {
        const l = this.constEval(expr.left);
        const r = this.constEval(expr.right);
        switch (expr.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return Math.floor(l / r);
          default:
            throw new CompileError("unsupported constant expression", expr);
        }
      }
      default:
        throw new CompileError("expected a constant expression", expr);
    }
  }
}

// ---- Reserved zero-page compiler-temp addresses (0x00-0x0f - see layout comment above) ----
const RESERVED_TEMPS: Record<string, number> = {
  RESULT: 0x00, // 2 bytes: primary expression accumulator
  RESULTC: 0x00, // alias: byte view of RESULT's low byte
  LHS: 0x02, // 2 bytes: left operand scratch for binary ops
  RHS: 0x04, // 2 bytes: right operand scratch for binary ops
  PTR1: 0x06, // 2 bytes: array element address scratch
  T1: 0x0e, // 2 bytes: value scratch for indexed writes (used alongside PTR1)
  MULN: 0x08, // 1-2 bytes: multiply/divide bit counter
  DIVQ: 0x0a, // 2 bytes: division quotient
  DIVR: 0x0c, // 2 bytes: division remainder
  RETVAL: 0x00, // alias: RESULT, used to read a just-returned function value
  NUMBUF: 0x08, // 8 bytes (0x08-0x0f): decimal-conversion scratch buffer for print(int)
  // (safe to alias with MULN/DIVQ/DIVR - never live across a print() call)
};

function zp(name: string): string {
  if (!(name in RESERVED_TEMPS))
    throw new Error(`unknown compiler temp '${name}'`);
  return name;
}

function hexByte(n: number): string {
  return "0x" + (n & 0xff).toString(16).padStart(2, "0");
}

function hexWord(n: number): string {
  return "0x" + (n & 0xffff).toString(16).padStart(4, "0");
}

/** Escapes a string for embedding in a single-quoted assembly string literal. Since the
 *  assembler's string literals emit each character byte-for-byte with no escape handling
 *  of their own, this just guards against literal single-quote characters (which would
 *  otherwise prematurely terminate the assembler's own string token) by splitting them
 *  into a separate quoted-char/data sequence is not supported here - MIN string literals
 *  containing a literal "'" are not yet supported by this compiler. */
function escapeForAsmString(s: string): string {
  if (s.includes("'")) {
    throw new Error(
      `string literals containing "'" are not yet supported by this compiler: ${JSON.stringify(s)}`,
    );
  }
  return s;
}

export const minCompiler = new MinCompiler();
