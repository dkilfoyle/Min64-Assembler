## Memory

executable code starts at 0x2000
data memory for variables and expression stack starts at 0xd000 to 0xefff (beyond 0xefff will collide with MinOS) = 8k
z_sp is a pointer in zp that points to the current address in the data memory
local variables are added to the data stack
expression results are added to the expression stack which is continuation of data stack

## Variables

In MinInterp Variables are added to a virtual stack of 1408 bytes that grows upwards from [firstp,endsp) = [0x3a00, 0x3f80)

> Compiler doesnt need space for interpreter, call dict, var dict or use dict so virtual stack could (?) grow from 0x1000-0x3fff = 12k

z_sp is a pointer in zero page to the ?top ?current byte or LSB word
z_spi is a pointer in zero page to the ?top ?current MSB word

## Factor

### Variable

Retrieve info from vardict and push onto stack
stack = [ptrMSB, ptrLSB, cntMSB, cntLSB, type, ......]

fac_fullvar:
z_cnt from stack 4,3
z_A = z_cnt to use as byte counter
z_type from stack 5
if z_type word then double z_A for 2 bytes per element
fac_src = ptrLSB,ptrMSB
fac_dst = z_sp
copy every byte of var to z_sp not changing z_sp
? why is this "faster" than accessing in place
why cant we have a z_varptr which points to the first byte of the var in datamemory
because the copy can be edited in place eg xcopy+=10

so at end of JPS Factor
z_cnt = number of elements
z_type = element size
z_sp = start of bytes

So in term can do
JPS Factor
JPS get - reads 1 element from z_sp into z_A

## Expressions

Each expression generates it result on the expression stack

- number literals are returned as int
  result is available at \*z_sp and could be int or byte
  get will retrieve result at z_sp into z_A
- char are cast to int and sign extended

// =====================================================================================
// Expression compiler for the slu4coder "Minimal 64x4" CPU
// =====================================================================================
//
// Targets the real Minimal 64x4 instruction set (256 opcodes, 8-bit accumulator A,
// N/C/Z flags, zero-page ("Z"/"V"/"Q" fast addressing), abs addressing, PHS/PLS hw
// stack, JPS/RTS subroutines). The codegen idioms below (accumulator-pair evaluation
// via PHS/PLS, sign-extension via LL1+carry, signed comparison via negate+add+branch,
// and the **mul16/**div16/**shl16/**shr16 runtime routines) are ported directly from
// slu4coder's own MIN language implementation, so the emitted code follows the same
// conventions as the reference toolchain.
//
// -------------------------------------------------------------------------------------
// LANGUAGE
// -------------------------------------------------------------------------------------
// Primary := number | identifier | identifier '(' [expr (',' expr)*] ')' | '(' expr ')'
// Unary := ('-' | 'not') Unary | Primary
// Factor := Unary (('_' | '/') Unary)_
// BaseExpr := Factor (('+' | '-') Factor)_
// RelExpr := BaseExpr (('<' | '>' | '<=' | '>=' | '==' | '!=') BaseExpr)_
// Expr := RelExpr (('and' | 'or' | 'xor' | '<<' | '>>') RelExpr)_
//
// This mirrors MIN's own precedence layering (Factor -> BaseExpr -> RelExpr -> Expr),
// i.e. shifts/bitwise-logic bind loosest and comparisons bind tighter than them but
// looser than +/-. 'and'/'or'/'xor' are NOT short-circuiting: both sides are always
// evaluated and combined bitwise, which works correctly because booleans are encoded
// as 0x0000 / 0xffff.
//
// Byte variables are sign-extended to int (16-bit) wherever they're read in an
// expression. All expressions produce a 16-bit int result. A true comparison produces
// 0xffff, false produces 0x0000.
//
// -------------------------------------------------------------------------------------
// CALLING CONVENTION (confirmed with user: software stack via PHS/PLS + LDS/STS)
// -------------------------------------------------------------------------------------
// - Arguments are evaluated left-to-right; each argument (always a 16-bit int, byte
// args get sign-extended by the caller before pushing) is pushed low-byte-then-
// high-byte via PHS, so the stack holds: arg1_lo, arg1_hi, arg2_lo, arg2_hi, ...
// - The call site then does JPS <function label>, which itself pushes a 2-byte return
// address on top of the arguments (same 0xff00+SP hardware stack used by PHS/PLS).
// - The callee is responsible for reading its arguments via LDS with the appropriate
// offset (offset 0/1 = return address, offset 2/3 = last-pushed argument, etc. --
// exact offsets depend on how much the callee's own prologue moves SP) and MUST
// leave its 16-bit result in the \_\_A zero-page word before executing RTS.
// - After the call returns, the caller discards the pushed argument bytes with one
// PLS per byte (2 _ argCount), then continues using **A, which already holds the
// call's result -- no explicit "restore" step is needed.
//
// -------------------------------------------------------------------------------------
// ZERO PAGE LAYOUT (10 bytes total, base address configurable -- see zpBase option)
// -------------------------------------------------------------------------------------
// **A (word) primary accumulator: current expression value / function result
// **B (word) secondary operand (rhs of binary ops) / shift-or-loop scratch
// **C (word) scratch used by **mul16 / **div16
// **D (word) scratch used by **div16 (quotient accumulation)
// **cnt (byte) loop counter used by **mul16 / **div16 / **shl16 / **shr16
// **flag (byte) sign flag used by **div16
//
// -------------------------------------------------------------------------------------
// KNOWN LIMITATIONS (ported directly from MIN's own math library -- see notes below)
// -------------------------------------------------------------------------------------
// - **div16 (and therefore '/') requires the DIVISOR's magnitude to fit in a byte
// (-255..255) after sign removal, exactly like MIN's int_div. This is a real
// constraint of the ported algorithm, not an oversight -- ask if you need a fully
// general 16/16 divisor version instead (slower, more code).
// - '>>' is a LOGICAL (zero-fill) right shift, matching MIN's int_lsr exactly, not an
// arithmetic (sign-preserving) shift, even though ints are signed.
// - This compiler generates only 2-byte absolute branches/jumps (BEQ/BNE/BPL/.../JPA),
// never the 1-byte "fast" (F\*) same-page forms, since a generic code generator can't
// guarantee branch targets stay within one 256-byte page.
// =====================================================================================
