/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { ValidationAcceptor, ValidationCategory, ValidationChecks } from "langium";
import { Data, type Directive, type Instruction, type MinasmAstType, Program, isStringLiteral } from "./generated/ast.js";
import type { MinasmServices } from "./minasm-module.js";
import { instructionInfo } from "../assembler/instructionInfo.js";
import { getArgTypes, getExpressionSize } from "../assembler/utils.js";
// import { getExpressionSize } from "../assembler/utils.js";

export function registerValidationChecks(services: MinasmServices) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.MinasmValidator;
  const checks: ValidationChecks<MinasmAstType> = {
    Directive: (state, accept) => validator.checkOrgAddress(state, accept),
    Instruction: (state, accept) => validator.checkInstructionArgs(state, accept),
    Data: (state, accept) => validator.checkDataArgs(state, accept),
    Program: (state, accept) => validator.checkProgram(state, accept),
  };
  registry.register(checks, validator);
}

export class MinasmValidator {
  private curInstr: Instruction | null = null;
  checkProgram(program: Program, accept: ValidationAcceptor) {
    this.curInstr = null;
  }
  checkOrgAddress(dir: Directive, accept: ValidationAcceptor): void {
    if (dir.dir == "#org") {
      if (dir.address == undefined) accept("error", "#org directive needs address", { node: dir, property: "dir" });
      else if (dir.address > 0xffff) accept("warning", "#org address must be < 0xffff", { node: dir, property: "address" });
    }
  }
  checkInstructionArgs(instr: Instruction, accept: ValidationAcceptor): void {
    const info = instructionInfo[instr.op];
    this.curInstr = info.argType.length ? instr : null;
  }
  checkDataArgs(data: Data, accept: ValidationAcceptor): void {
    if (this.curInstr) {
      const info = instructionInfo[this.curInstr!.op];
      let size = 0;
      let dataIndex = 0;
      for (let argIndex = 0; argIndex < info.argType.length; argIndex++) {
        const expectedArgType = info.argType[argIndex];
        const expectedArgSize = info.argSize[argIndex];
        const isLSB = expectedArgType == 2 || expectedArgType == 4;
        const curDataItem = data.items[dataIndex++];
        const curDataSize = getExpressionSize(curDataItem);

        if (expectedArgSize == 1) {
          if (curDataSize == 1 || isLSB) {
            size += 1;
          } else {
            size += curDataSize;
          }
        } else if (expectedArgSize == 2) {
          if (curDataSize == 1) {
            const nextDataItem = data.items[dataIndex++];
            const nextDataSize = getExpressionSize(nextDataItem);
            size += curDataSize + nextDataSize; // 2 consecutive bytes
          } else size += curDataSize;
        }
      }

      for (let remainingItem = dataIndex; remainingItem < data.items.length; remainingItem++) {
        size += getExpressionSize(data.items[remainingItem]);
      }

      if (size != info.totalSize) {
        accept("error", `Invalid arguments: expecting ${info.totalSize} bytes, got ${size}`, { node: data });
        accept("warning", `${info.instr} expects arguments: ${getArgTypes(info.argType)}`, { node: this.curInstr, property: "op" });
      }
      this.curInstr = null;
    }
  }
}
