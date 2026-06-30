/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { ValidationAcceptor, ValidationChecks } from "langium";
import type { Directive, MinasmAstType } from "./generated/ast.js";
import type { MinasmServices } from "./minasm-module.js";
import { MultiMap } from "langium";

export function registerValidationChecks(services: MinasmServices) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.MinasmValidator;
  const checks: ValidationChecks<MinasmAstType> = {
    Directive: (state, accept) => validator.checkOrgAddress(state, accept),
  };
  registry.register(checks, validator);
}

export class MinasmValidator {
  /**
   * Checks if the state name starts with a capital letter.
   * @param state the state to check
   * @param accept the acceptor to report errors
   */
  checkOrgAddress(dir: Directive, accept: ValidationAcceptor): void {
    if (dir.dir == "#org") {
      if (dir.address == undefined) accept("error", "#org directive needs address", { node: dir, property: "dir" });
      else if (parseInt(dir.address, 16) > 0xffff) accept("warning", "#org address must be < 0xffff", { node: dir, property: "address" });
    }
  }
}
