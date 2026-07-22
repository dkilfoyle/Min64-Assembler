// emitByteExpression(e: Expression): void {
//   // A = evaluated e where e is an 8 bit result
//   switch (true) {
//     case isNumberLiteral(e):
//       this.compiler.emit(`LDI ${immByte(e.value)}`);
//       return;
//     case isVariableReference(e): {
//       const entry = this.compiler.symbols.vars.get(e.varName.$refText)!;
//       this.compiler.emit(`LDZ ${lowOperand(entry.addr)} ; ${e.varName.$refText}`);
//       return;
//     }
//     case isUnaryExpression(e):
//       this.compiler.emit("; " + e.$cstNode?.text);
//       if (e.op == "-") {
//         this.emitByteExpression(e.expr);
//         this.compiler.emit("NEG");
//       } else if (e.op == "not") {
//         this.emitByteExpression(e.expr);
//         this.compiler.emit("NOT");
//       } else throw Error("Uknown unary operation");
//       return;
//     case isComparisonExpression(e):
//       this.emitByteCmp(e);
//       return;
//     case isBinaryExpression(e):
//       this.emitByteBinop(e);
//       return;
//   }
// }

// emitByteBinop(e: BinaryExpression): void {
//   const { op, left, right } = e;

//   if (op === "*") {
//     this.emitByteMultiply(left, right);
//     return;
//   }
//   if (op === "<<" || op === ">>") {
//     this.emitByteShift(op, left, right);
//     return;
//   }

//   if (isNumberLiteral(right)) {
//     if (!(op in IMM_MNEMONIC)) throw Error(`invalid op for binary expression left ${op} number`);
//     this.emitByteExpression(left);
//     this.compiler.emit(`${IMM_MNEMONIC[op as keyof typeof IMM_MNEMONIC]} ${immByte(right.value)}`); // eg ADI/SUI imm
//     return;
//   }

//   if (isVariableReference(right)) {
//     this.emitByteExpression(left);
//     const entry = this.compiler.symbols.vars.get(right.varName.$refText)!;
//     if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression left ${op} var`);
//     this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${lowOperand(entry.addr)}`); // eg ADZ/SUZ var
//     return;
//   }

//   // can do right first because order doesn't matter
//   if (COMMUTATIVE.has(op)) {
//     // num/var commutative_op right
//     //
//     if (isNumberLiteral(left)) {
//       if (!(op in IMM_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
//       this.emitByteExpression(right);
//       this.compiler.emit(`${IMM_MNEMONIC[op as keyof typeof IMM_MNEMONIC]} ${immByte(left.value)}`);
//       return;
//     } else if (isVariableReference(left)) {
//       if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
//       this.emitByteExpression(right);
//       const entry = this.compiler.symbols.vars.get(left.varName.$refText)!;
//       this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${lowOperand(entry.addr)}`);
//       return;
//     } else {
//       // order doesnt matter so do most expensive first so need fewer overall zp slots
//       if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
//       const [first, second] = costByte(left) >= costByte(right) ? [left, right] : [right, left];
//       this.emitByteExpression(first);
//       const t = this.bytes.alloc();
//       this.compiler.emit(`STZ ${hexByte(t)}`);
//       this.emitByteExpression(second);
//       this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${hexByte(t)}`);
//       this.bytes.free(t);
//       return;
//     }
//   } else {
//     // order does matter
//     if (!(op in Z_MNEMONIC)) throw Error(`invalid op for binary expression ${left.$type} ${op} ${right.$type}`);
//     this.emitByteExpression(right);
//     const t = this.bytes.alloc();
//     this.compiler.emit(`STZ ${hexByte(t)}`);
//     this.emitByteExpression(left);
//     this.compiler.emit(`${Z_MNEMONIC[op as keyof typeof Z_MNEMONIC]} ${hexByte(t)}`);
//     this.bytes.free(t);
//     return;
//   }
// }

// emitByteShift(op: "<<" | ">>", left: Expression, right: Expression): void {
//   const stepMnemonic = op === "<<" ? "LL" : "LR";

//   if (isNumberLiteral(right)) {
//     const k = right.value & 0xff;
//     this.emitByteExpression(left);
//     if (k === 0) return; // no-op
//     if (k >= 8) {
//       this.compiler.emit(`LDI ${immByte(0)}`); // shifted fully out
//       return;
//     }
//     this.compiler.emit(`${stepMnemonic}${k}`); // single-instruction shift-by-k
//     return;
//   }

//   // Runtime shift count: loop, shifting one step at a time.
//   this.emitByteExpression(left);
//   const work = this.bytes.alloc();
//   this.compiler.emit(`STZ ${hexByte(work)}`);
//   this.emitByteExpression(right);
//   const count = this.bytes.alloc();
//   this.compiler.emit(`STZ ${hexByte(count)}`);

//   const loop = this.compiler.nextLabel("SHB");
//   const done = this.compiler.nextLabel("SHBEND");
//   this.compiler.emit(`${loop}:`);
//   this.compiler.emit(`LDZ ${hexByte(count)}`);
//   this.compiler.emit(`BEQ ${done}`);
//   this.compiler.emit(`LDZ ${hexByte(work)}`);
//   this.compiler.emit(`${stepMnemonic}1`);
//   this.compiler.emit(`STZ ${hexByte(work)}`);
//   this.compiler.emit(`DEZ ${hexByte(count)}`);
//   this.compiler.emit(`JPA ${loop}`);
//   this.compiler.emit(`${done}:`);
//   this.compiler.emit(`LDZ ${hexByte(work)}`);

//   this.bytes.free(count);
//   this.bytes.free(work);
// }

// emitByteMultiply(left: Expression, right: Expression): void {
//   const constSide = isNumberLiteral(left) ? left : isNumberLiteral(right) ? right : null;
//   const otherSide = constSide === left ? right : left;

//   if (constSide) {
//     const k = constSide.value & 0xff;
//     if (k === 0) {
//       // anything * 0 = 0
//       this.compiler.emit(`LDI ${immByte(0)}`);
//       return;
//     }
//     if (k === 1) {
//       // anything * 1 = anything
//       this.emitByteExpression(otherSide);
//       return;
//     }
//     const shift = Math.log2(k);
//     if (Number.isInteger(shift) && shift >= 1 && shift <= 7) {
//       // multiplying anything by 2,4,8,16,32,64,128 same as LL1-7
//       this.emitByteExpression(otherSide);
//       this.compiler.emit(`LL${shift}`);
//       return;
//     }
//   }

//   if (isNumberLiteral(right) || isVariableReference(right)) {
//     this.emitByteExpression(left);
//     this.compiler.emit(`STZ mulOperandA`);
//     this.emitByteExpression(right);
//     this.compiler.emit(`STZ mulOperandB`);
//   } else {
//     this.emitByteExpression(right);
//     const t = this.bytes.alloc();
//     this.compiler.emit(`STZ ${hexByte(t)}`); // temp = right
//     this.emitByteExpression(left);
//     this.compiler.emit(`STZ mulOperandA`);
//     this.compiler.emit(`LDZ ${hexByte(t)}`);
//     this.compiler.emit(`STZ mulOperandB`);
//     this.bytes.free(t);
//   }
//   this.compiler.emit(`JPS mulRoutine`);
// }

// /** a OP b (unsigned, byte width) -> 0/1 in A, via CPx + BCC/BCS/BEQ/BNE. */
// emitByteCmp(e: ComparisonExpression): void {
//   let { op, left, right } = e;

//   // a > b  <=>  b < a ; a <= b <=> b >= a. Swap so only 4 primitive
//   // conditions (== != < >=) are ever actually emitted.
//   if (op === ">") {
//     [left, right] = [right, left];
//     op = "<";
//   } else if (op === "<=") {
//     [left, right] = [right, left];
//     op = ">=";
//   }

//   // Evaluate into A (left) and a CPx-comparable right operand, reusing the
//   // same leaf-fold-vs-spill strategy as arithmetic ops.
//   if (isNumberLiteral(right)) {
//     this.emitByteExpression(left);
//     this.compiler.emit(`CPI ${immByte(right.value)}`);
//   } else if (isVariableReference(right)) {
//     this.emitByteExpression(left);
//     const entry = this.compiler.symbols.vars.get(right.varName.$refText)!;
//     this.compiler.emit(`CPZ ${lowOperand(entry.addr)}`);
//   } else {
//     this.emitByteExpression(right);
//     const t = this.bytes.alloc();
//     this.compiler.emit(`STZ ${hexByte(t)}`);
//     this.emitByteExpression(left);
//     this.compiler.emit(`CPZ ${hexByte(t)}`);
//     this.bytes.free(t);
//   }

//   const branch = op === "==" ? "BEQ" : op === "!=" ? "BNE" : op === "<" ? "BCC" : "BCS"; // >=

//   const trueLabel = this.compiler.nextLabel("CT");
//   const endLabel = this.compiler.nextLabel("CE");
//   this.compiler.emit(`${branch} ${trueLabel}`);
//   this.compiler.emit(`LDI ${immByte(0)}`);
//   this.compiler.emit(`JPA ${endLabel}`);
//   this.compiler.emit(`${trueLabel}:`);
//   this.compiler.emit(`LDI ${immByte(1)}`);
//   this.compiler.emit(`${endLabel}:`);
// }


  // widthOf(e: Expression): Width {
  //   switch (true) {
  //     case isNumberLiteral(e):
  //       return e.value > 255 ? 16 : 8;
  //     case isVariableReference(e): {
  //       const entry = this.compiler.symbols.vars.get(e.varName.$refText);
  //       if (!entry) throw new Error(`Undefined variable '${e.varName.$refText}'`);
  //       return entry.width;
  //     }
  //     case isUnaryExpression(e):
  //       return this.widthOf(e.expr);
  //     case isComparisonExpression(e):
  //       return 8;
  //     case isBinaryExpression(e): {
  //       const lw = this.widthOf(e.left);
  //       if (e.op === "<<" || e.op === ">>") return lw; // because rw will always be 8
  //       const rw = this.widthOf(e.right);
  //       if (lw !== rw) {
  //         // throw new Error(`Width mismatch in '${e.op}': left is ${lw}-bit, right is ${rw}-bit (no implicit widening)`);
  //         return 16;
  //       }
  //       return lw;
  //     }
  //     default:
  //       throw Error("Widthof unknown expression type " + e.$type);
  //   }
  // }