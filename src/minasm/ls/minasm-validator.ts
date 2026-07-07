/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { ValidationAcceptor, ValidationChecks } from "langium";
import { type Directive, type Instruction, type MinasmAstType, isStringLiteral } from "./generated/ast.js";
import type { MinasmServices } from "./minasm-module.js";
import { instructionInfo } from "../assembler/instructionInfo.js";
// import { getExpressionSize } from "../assembler/utils.js";

export function registerValidationChecks(services: MinasmServices) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.MinasmValidator;
  const checks: ValidationChecks<MinasmAstType> = {
    Directive: (state, accept) => validator.checkOrgAddress(state, accept),
    // Instruction: [
    //   // (state, accept) => validator.checkInstructionArgsSize(state, accept),
    //   (state, accept) => validator.checkInstructionArgsStringSize(state, accept),
    // ],
  };
  registry.register(checks, validator);
}

export class MinasmValidator {
  checkOrgAddress(dir: Directive, accept: ValidationAcceptor): void {
    if (dir.dir == "#org") {
      if (dir.address == undefined) accept("error", "#org directive needs address", { node: dir, property: "dir" });
      else if (dir.address > 0xffff) accept("warning", "#org address must be < 0xffff", { node: dir, property: "address" });
    }
  }
  // checkInstructionArgsSize(instr: Instruction, accept: ValidationAcceptor): void {
  //   const expectedSize = instructionInfo[instr.op].size;
  //   let size = 1;
  //   for (const operand of instr.operands) {
  //     const
  //     size += getExpressionSize(operand);
  //   }
  //   if (size != expectedSize)
  //     accept("error", `${instr.op} expects operands size ${expectedSize - 1}, got ${size - 1}`, { node: instr, property: "operands" });
  // }
  // checkInstructionArgsStringSize(instr: Instruction, accept: ValidationAcceptor): void {
  //   for (const operand of instr.operands) {
  //     if (isStringLiteral(operand) && operand.value.length != 1)
  //       accept("error", `Must be single character`, { node: operand, property: "value" });
  //   }
  // }
}
