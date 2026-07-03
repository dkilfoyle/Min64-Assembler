/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { ValidationAcceptor, ValidationChecks } from "langium";
import type { Directive, Instruction, MinasmAstType } from "./generated/ast.js";
import type { MinasmServices } from "./minasm-module.js";
import { instructionInfo } from "../assembler/instructionInfo.js";

export function registerValidationChecks(services: MinasmServices) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.MinasmValidator;
  const checks: ValidationChecks<MinasmAstType> = {
    Directive: (state, accept) => validator.checkOrgAddress(state, accept),
    Instruction: (state, accept) => validator.checkInstructionArgs(state, accept),
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
  checkInstructionArgs(instr: Instruction, accept: ValidationAcceptor): void {
    const expectedArgs = instructionInfo[instr.op].args;
    let numExpectedArgs = 0;
    if (expectedArgs & 0x0f) numExpectedArgs++;
    if (expectedArgs & 0xf0) numExpectedArgs++;
    if (numExpectedArgs != instr.operands.length)
      accept("warning", `${instr.op} expects ${numExpectedArgs} arguments`, { node: instr, property: "operands" });
  }
}
