import {
  BinaryExpression,
  ComparisonExpression,
  FunctionCall,
  isBinaryExpression,
  isComparisonExpression,
  isFunctionCall,
  isNumberLiteral,
  isUnaryExpression,
  isVariableReference,
  NumberLiteral,
  UnaryExpression,
  VariableReference,
  type Expression,
} from "../ls/generated/ast";
import type { MinCompiler } from "./compiler";
import { hexByte, hexWord } from "./utils";

export class ExpressionCompiler {
  private zpBase: number;

  // computed zero-page addresses (word regs are 2 bytes: +0 = lsb, +1 = msb)
  readonly A: number;
  readonly B: number;
  readonly C: number;
  readonly D: number;
  readonly CNT: number;
  readonly FLAG: number;

  compiler: MinCompiler;

  constructor(minCompiler: MinCompiler) {
    this.compiler = minCompiler;
    this.zpBase = 0x00;

    this.A = this.zpBase + 0;
    this.B = this.zpBase + 2;
    this.C = this.zpBase + 4;
    this.D = this.zpBase + 6;
    this.CNT = this.zpBase + 8;
    this.FLAG = this.zpBase + 9;
  }

  out(instruction: string, comment?: string) {
    this.compiler.out(instruction, comment);
  }

  private pushWord(addr: number) {
    this.out(`LDZ ${hexByte(addr)} PHS LDZ ${hexByte(addr + 1)} PHS`, `push *(${hexByte(addr)})`);
  }
  private popWord(addr: number) {
    this.out(`PLS STZ ${hexByte(addr + 1)} PLS STZ ${hexByte(addr)}`, `pop to ${hexByte(addr)}`);
  }
  private pushZA() {
    this.out(`LDZ zA+0 PHS LDZ zA+1 PHS`, `push z_A`);
  }
  private popZA() {
    this.out(`PLS STZ zA+1 PLS STZ z_A+0`, `pop to z_A`);
  }

  /** Compile expr, leaving the 16-bit result in the z_A zero-page word. */
  compileExpression(e: Expression): void {
    switch (true) {
      case isNumberLiteral(e):
        return this.compileNum(e);
      case isVariableReference(e):
        return this.compileVar(e);
      case isFunctionCall(e):
        return this.compileCall(e);
      case isUnaryExpression(e):
        return this.compileUnary(e);
      case isComparisonExpression(e):
        return this.compileComparison(e);
      case isBinaryExpression(e):
        return this.compileBinary(e);
    }
  }

  private compileNum(e: NumberLiteral) {
    this.out(`MIV ${hexWord(e.value)},${hexByte(this.A)}`, `const ${e.value}`);
  }

  private compileVar(e: VariableReference) {
    const varName = e.varName.$refText;
    const v = this.compiler.getSymbolInfo(varName);
    if (!v) throw new Error(`Unknown variable '${varName}'`);
    if (v.kind != "variable") throw new Error(`Expected variable received function`);

    const isZP = (v.address & 0xff00) == 0;

    if (v.type === "int") {
      if (isZP) {
        this.out(`MVV ${hexByte(v.address)},z_A`, `${varName} (int, zp)`);
      } else {
        this.out(`MWV ${hexWord(v.address)},z_A)`, `${varName} (int, abs)`);
      }
      return;
    } else {
      // byte
      if (isZP) {
        this.out(`LDZ ${hexByte(v.address)}`, `${varName} (byte, zp)`);
      } else {
        this.out(`LDB ${hexWord(v.address)}`, `${varName} (byte, abs)`);
      }
      this.out("JPS __signext");
    }
  }

  private compileCall(e: FunctionCall) {
    const functionName = e.functionName.$refText;
    const f = this.compiler.getSymbolInfo(functionName);
    if (!f) throw new Error(`Unknown function '${functionName}'`);
    if (f.kind != "function") throw new Error(`Expected function received variable`);

    for (const arg of e.args) {
      this.compileExpression(arg); // result -> __A
      this.pushZA(); // push __A onto hw stack (lsb, msb)
    }

    this.out(`JPS ${functionName}`, `call ${functionName}(${e.args.length} arg${e.args.length === 1 ? "" : "s"})`);
    if (e.args.length > 0) {
      this.out(`${"PLS ".repeat(e.args.length * 2).trim()}`, `discard ${e.args.length * 2} pushed arg byte(s)`);
    }
    // return value convention: callee leaves result in __A
  }

  private compileUnary(e: UnaryExpression) {
    this.compileExpression(e.inner);
    if (e.op === "-") {
      this.out(`NEV z_A`, `unary -`);
    } else {
      this.out(`NOV z_A`, `unary not (bitwise complement)`);
    }
  }

  private compileBinary(e: BinaryExpression) {
    const constSide = isNumberLiteral(e.left) ? e.left : isNumberLiteral(e.right) ? e.right : null;
    const otherSide = constSide === e.left ? e.right : e.left;

    if (constSide) {
      // constant operand optimisations
      if (e.op == "+") {
        this.compileExpression(otherSide);
        if (constSide.value == 1) {
          this.out(`INV z_A`, `++`);
          return;
        } else if ((constSide.value & 0xff00) == 0) {
          // anything + byte constant (or vice versa)
          this.out(`AIV ${constSide.value},z_A`, `+ byte constant`);
          return;
        } else {
          // anything + byte constant (or vice versa)
          this.out(`MIV ${constSide.value},z_B AVV z_B,z_A`, `+ word constant`);
          return;
        }
      }
      if (e.op == "-" && isNumberLiteral(e.right)) {
        if (e.right.value == 1) {
          this.out(`DEV z_A`, `--`);
        } else if ((e.right.value & 0xff00) == 0) {
          // anything - byte constant
          this.compileExpression(e.left);
          this.out(`SIV ${e.right.value},z_A`, `- byte constant`);
          return;
        }
      }
      if (e.op == "*") {
        // anything * power of 2 (or vice versa)
        const shift = Math.log2(constSide.value);
        if (Number.isInteger(shift) && shift >= 1 && shift <= 15) {
          this.compileExpression(otherSide);
          this.out(`MIV ${shift}, z_B JPS __shl16`);
          return;
        }
      }
    }

    // evaluate left, save; evaluate right into __A, move to __B; restore left into __A
    this.compileExpression(e.left);
    this.pushZA();

    this.compileExpression(e.right);
    this.out(`MVV z_A,z_B`);
    this.popZA();
    // now __A = left, __B = right

    switch (e.op) {
      case "+":
        this.out(`AVV $z_B,z_A`, `+`);
        break;
      case "-":
        this.out(`SVV z_B,z_A`, `-`);
        break;
      case "*":
        this.out(`JPS __mul16`, `*`);
        break;
      case "/":
        this.out(`JPS __div16`, `/ (divisor magnitude must fit in a byte)`);
        break;
      case "and":
        this.out(`JPS __and16`, `and`);
        break;
      case "or":
        this.out(`JPS __or16`, `or`);
        break;
      case "xor":
        this.out(`JPS __xor16`, `xor`);
        break;
      case "<<":
        this.out(`JPS __shl16`, `<<`);
        break;
      case ">>":
        this.out(`JPS __shr16`, `>> (logical)`);
        break;
      default:
        throw new Error(`Unhandled binary operator '${e.op}'`);
    }
  }

  // Comparisons: ported from MIN's RelExpr. Left in __A, pushed; right computed into
  // __A then moved to __B; combine into __B via negate+add (or plain subtract for
  // <=/>=/>) and branch on sign to produce 0xffff/0x0000 in __A.
  private compileComparison(e: ComparisonExpression) {
    this.compileExpression(e.left);
    this.pushZA();

    this.compileExpression(e.right);
    this.out(`MVV z_A,z_B`);

    const trueLabel = this.compiler.nextLabel("cmp_true");
    const doneLabel = this.compiler.nextLabel("cmp_done");

    switch (e.op) {
      // PLS after each JPS to discard the
      case "<":
        this.out("JPS __lt16", "<");
        break;
      case ">":
        this.out("JPS __gt16", "<");
        break;
      case "==":
        this.out("JPS _eq16", "==");
        break;
      case "!=":
        this.out("JPS _neq16", "==");
        break;
      case "<=":
        this.out("JPS _lteq16", "==");
        break;
      case ">=":
        this.out("JPS _gteq16", "==");
        break;
      default:
        throw new Error(`Unhandled comparison operator '${e.op}'`);
    }

    this.out("PLS", "discard saved left expr off stack");
  }

  // --- output assembly ---

  header(): string[] {
    const out: string[] = [];
    out.push(`; ---- expression compiler zero-page working storage ----`);
    out.push(`#org ${hexWord(this.zpBase)}`);
    out.push(`z_A:      0x0000    ; accumulator / expression result / fn return value`);
    out.push(`z_B:      0x0000    ; secondary operand`);
    out.push(`z_C:      0x0000    ; scratch (mul/div/cmp)`);
    out.push(`z_D:      0x0000    ; scratch (div quotient)`);
    out.push(`z_cnt:    0x00      ; loop counter (mul/div/shifts)`);
    out.push(`z_flag:   0x00      ; sign flag (div)`);
    out.push(``);
    return out;
  }

  /** Runtime helper library. Ported from slu4coder's MIN int_mul/int_div/int_lsl/int_lsr. */
  runtimeLibrary(): string[] {
    return `
; ---- runtime helpers ----

#page

; 16 x 16 -> 16 unsigned/signed-safe multiply (two's-complement wraps correctly)
; in: __A, __B   out: __A = __A * __B   clobbers: __B, __C, __cnt
__mul16:      MVV z_A,z_C
              CLV z_A
              MIZ 16,z_cnt
  __mul16_lp: RRZ z_C+1 RRZ z_C
              FCC __mul16_off
                AVV z_B,z_A
  __mul16_off:  LLV z_B
              DEZ z_cnt FNE __mul16_lp
              RTS

; 16 / 16 -> 16 signed divide. NOTE: divisor magnitude must fit in a byte (-255..255)
; after sign removal -- ported directly from MIN's int_div, same limitation applies.
; in: __A (dividend), __B (divisor)   out: __A = __A / __B   clobbers: __B,__C,__D,__cnt,__flag
__div16:      CLZ z_flag
              LDZ z_A+1 CPI 0 FPL __div_anotneg
                INZ z_flag NEV z_A
  __div_anotneg: LDZ z_B+1 CPI 0 FPL __div_bnotneg
                INZ z_flag NEV z_B
  __div_bnotneg: MZZ z_B,z_B+1 CLZ z_B
              CLV z_D
              MIZ 8,z_cnt
  __div_up:     LDZ z_B+1 LL1 BMI __div_loop
                STZ z_B+1 INZ z_cnt FPA __div_up
  __div_loop:   MVV z_A,z_C
                LDZ z_B SUV z_A FCC __div_carry0
                SZZ z_B+1,z_A+1 FCS __div_result
  __div_carry0:   MVV z_C,z_A
  __div_result: RLV z_D
              LRZ z_B+1 RRZ z_B
              DEZ z_cnt FCS __div_loop
                MVV z_D,z_A
                LDZ z_flag LR1 FCC __div_allnotneg
                  NEV z_A
  __div_allnotneg: RTS

; 16-bit bitwise AND / OR / XOR (byte-wise; no native word forms on this ISA)
; in: __A, __B   out: __A   clobbers: nothing else
__and16:      LDZ z_B+1 AN.Z z_A+1
              LDZ z_B AN.Z z_A
              RTS
__or16:       LDZ z_B+1 OR.Z z_A+1
              LDZ z_B OR.Z z_A
              RTS
__xor16:      LDZ z_B+1 XR.Z z_A+1
              LDZ z_B XR.Z z_A
              RTS

; 16-bit logical shift left / right by a variable count. count is __B's low byte,
; treated as signed: a negative count shifts the other direction (matches MIN's
; int_lsl / int_lsr exactly). Right shift is logical (zero-fill), not arithmetic.
; in: __A (value), __B (count)   out: __A   clobbers: __cnt
__shl16:      LDZ z_B CPI 0 FEQ __shl_done
              FPL __shl_pos
                NEG FPA __shr_pos
  __shl_pos:    STZ z_cnt
  __shl_loop:   LLV z_A DEZ z_cnt FNE __shl_loop
  __shl_done:   RTS

__shr16:      LDZ z_B CPI 0 FEQ __shr_done
              FPL __shr_pos
                NEG FPA __shl_pos
  __shr_pos:    STZ z_cnt
  __shr_loop:   LRZ z_A+1 RRZ z_A
              DEZ z_cnt FNE __shr_loop
  __shr_done:   RTS

; Sign-extends A into the __A zero-page word
__signext:
    STZ z_A+0 LL1 FCS sext_neg
      CLZ z_A+1 RTS
    sext_neg: MIZ 0xff,z_A+1 RTS

; left < right: left in stack, right in z_b <=> l + (-r) < 0
__lt16:
  NEV z_B                               ; l < r 
  LDS 2 AD.Z z_B+1 LDS 2 ADV z_B+0      ; z_B += pop (-r += l)
  FMI __lt16true
    CLV z_A RTS
  __lt16true:
    MIV 0xffff,z_A RTS

; left > right: left in stack, right in z_b <=> (-l) + r < 0
__gt16:
  LDS 2 STZ z_C+1 LDS 2 STZ z_C+0       ; z_C = l
  NEV z_C                               ; z_C = -l
  LDZ z_B+1 AD.Z z_C+1
  LDZ z_B+0 AD.Z z_C+0                  ; z_C += r
  FMI __gt16true
    CLV z_A RTS
  __lt16true: MIV 0xffff,z_A RTS

; left == right: left in stack, right in z_b 
__eq16:
  LDS 2 STZ z_C+1 LDS 2 STZ z_C+0       ; z_C = l
  LDZ z_C+1 CPZ z_B+1 FNE __eqfalse
  LDZ z_C+0 CPZ z_B+0 FNE __eqfalse
  MIV 0xffff,z_A RTS                    ; return true
  __eqfalse: CLV z_A RTS                ; return false;

; left != right: left in stack, right in z_b 
__neq16:
  LDS 2 STZ z_C+1 LDS 2 STZ z_C+0       ; z_C = l
  LDZ z_C+1 CPZ z_B+1 FNE __neqtrue
  LDZ z_C+0 CPZ z_B+0 FNE __neqtrue
  CLV z_A RTS                           ; return false
  __neqtrue: MIV 0xffff,z_A RTS         ; return true
  
; left <= right: left in stack, right in z_b <=> r-l >= 0
__lteq16:
  LDS 2 STZ z_C+1 LDS 2 STZ z_C+0       ; z_C = l
  SVV z_C,z_B                           ; z_B -= z_C (r-=l)
  FPL __lteq16true
  CLV z_A RTS                           ; return false
  __lteqtrue: MIV 0xffff,z_A RTS        ; return true

 ; left >= right: left in stack, right in z_b <=> l+(-r) >= 0
__gteq16:
  NEV z_B
  LDS 2 AD.Z z_B+1 LDS 2 ADV z_B+0      ; z_B += l
  FPL __gteq16true
  CLV z_A RTS                           ; return false
  __gteqtrue: MIV 0xffff,z_A RTS        ; return true

`.split("\n");
  }
}
