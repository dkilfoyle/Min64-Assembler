import type { StringLiteral } from "../../ls/generated/ast";
import { hexWord } from "../utils";
import { out } from "./compiler";
import type { IExpressionType } from "./variables";

const literals: string[] = [];

export function addStringLiteral(str: string): string {
  const label = `__str${literals.length}`;
  literals.push(str);
  return label;
}

export function emitStringLiterals() {
  literals.forEach((str, i) => {
    const label = `__str${i}`;
    out(
      `${label}: ${str
        .split("")
        .map((c) => c.charCodeAt(0))
        .join(", ")}, 0`,
      `"${str}"`,
    );
  });
}

export function compileStringLiteral(e: StringLiteral): IExpressionType {
  const str = e.value;
  if (str.length == 1) {
    out(
      `MIV ${hexWord(str.charCodeAt(0))},z_A+0`,
      `load character literal '${str}' into z_A`,
    );
    return "char";
  } else {
    const label = addStringLiteral(e.value);
    out(`MIV ${label},z_A`, `load address of string literal ${label} into z_A`);
    return "char*";
  }
}
