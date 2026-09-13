import type { Expression, GlobalElement, If, LocalElement, While } from "../../ls/generated/ast";
import { compileStatement, format, nextLabel, out } from "./compiler";
import { compileExpression } from "./expressions";
import { compileBlock } from "./functions";

export function compileIf(node: If) {
  const prefix = nextLabel("if");
  const endLabel = `${prefix}_end`;
  const chain: {
    condLabel: string | null;
    falseLabel: string;
    block: GlobalElement[];
  }[] = [];

  const branches: {
    condition: Expression;
    block: LocalElement[];
  }[] = [{ condition: node.condition, block: node.block }, ...node.elifs.map((e) => ({ condition: e.condition, block: e.block }))];

  let falseLabel = "";
  for (const branch of branches) {
    falseLabel = nextLabel(prefix + "_next");
    emitConditionJumpIfFalse(branch.condition, falseLabel);
    compileBlock(prefix + "_branch", branch.block);
    // for (const s of branch.block) compileStatement(s);
    out(`FPA ${endLabel}`);
    out(`${falseLabel}:`);
  }
  if (node.elseBlock) {
    compileBlock(falseLabel, node.elseBlock.block);
    // for (const s of node.elseBlock.block) compileStatement(s);
  }
  out(`${endLabel}:`);
}

export function compileWhile(node: While) {
  const whileLabel = nextLabel("while");
  const startLabel = whileLabel + "_start";
  const endLabel = whileLabel + "_end";
  const breakLabels: string[] = [];
  breakLabels.push(endLabel);
  out(`${startLabel}:`);
  format.indent += 2;
  emitConditionJumpIfFalse(node.condition, endLabel);
  format.indent -= 2;
  // for (const s of node.block) compileStatement(s);
  compileBlock(whileLabel, node.block);
  out(`FPA ${startLabel}`);
  out(`${endLabel}:`);
  breakLabels.pop();
}

function emitConditionJumpIfFalse(expr: Expression, falseLabel: string) {
  compileExpression(expr);
  out(`CIV 0x0000,z_A BEQ ${falseLabel}`);
}
