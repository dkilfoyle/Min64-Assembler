import type {
  Expression,
  GlobalElement,
  If,
  LocalElement,
  While,
} from "../../ls/generated/ast";
import { compileStatement, nextLabel, outi } from "./compiler";
import { compileExpression } from "./expressions";

export function compileIf(node: If) {
  const prefix = nextLabel("If");
  const endLabel = `${prefix}_end`;
  const chain: {
    condLabel: string | null;
    falseLabel: string;
    block: GlobalElement[];
  }[] = [];

  const branches: {
    condition: Expression;
    block: LocalElement[];
  }[] = [
    { condition: node.condition, block: node.block },
    ...node.elifs.map((e) => ({ condition: e.condition, block: e.block })),
  ];

  for (const branch of branches) {
    const falseLabel = nextLabel("if_next");
    emitConditionJumpIfFalse(branch.condition, falseLabel);
    for (const s of branch.block) compileStatement(s);
    outi(`FPA ${endLabel}`);
    outi(`${falseLabel}:`);
  }
  if (node.elseBlock) {
    for (const s of node.elseBlock.block) compileStatement(s);
  }
  outi(`${endLabel}:`);
}

export function compileWhile(node: While) {
  const startLabel = nextLabel("while_start");
  const endLabel = nextLabel("while_end");
  const breakLabels: string[] = [];
  breakLabels.push(endLabel);
  outi(`${startLabel}:`);
  emitConditionJumpIfFalse(node.condition, endLabel);
  for (const s of node.block) compileStatement(s);
  outi(`FPA ${startLabel}`);
  outi(`${endLabel}:`);
  breakLabels.pop();
}

function emitConditionJumpIfFalse(expr: Expression, falseLabel: string) {
  compileExpression(expr);
  outi(`CIV 0x0000,z_A BEQ ${falseLabel}`);
}
