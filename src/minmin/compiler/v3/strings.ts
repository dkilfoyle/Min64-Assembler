import type { CharLiteral, StringLiteral } from "../../ls/generated/ast";
import { hexByte, hexWord } from "../utils";
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

// export function compileStringLiteral(e: StringLiteral): IExpressionType {
//   const str = e.value;
//   if (str.length == 1) {
//     out(`MIV ${hexWord(str.charCodeAt(0))},z_A+0`, `load character literal '${str}' into z_A`);
//     return "char";
//   } else {
//     const label = addStringLiteral(e.value);
//     out(`MIV ${label},z_A MIV ${hexWord(label.length)},z_CNT`, `z_A=&str, z_CNT=length(str)`);
//     return "char*";
//   }
// }

export function compileStringLiteral(e: StringLiteral, destZ: string = "z_PTR2"): IExpressionType {
  out(`MVV ${destZ},z_A`, `z_A = &str[0]`);
  const str = e.value;
  str.split("").forEach((c) => out(`MIT ${hexByte(c.charCodeAt(0))},${destZ} INV ${destZ}`, `push character '${c}' onto ${destZ} stack`));
  out(`MIV ${hexWord(str.length)},z_B`, `z_B = length of string`);
  return "char*";
}

export function compileCharLiteral(e: CharLiteral): IExpressionType {
  const char = e.value;
  out(`MIV ${hexWord(char.charCodeAt(0))},z_A+0`, `load character literal '${char.replace(/\r?\n/g, "\\n")}' into z_A`);
  return "char";
}
