import { AstUtils, type AstNode } from "langium";
import {
  Expression,
  isBinaryExpression,
  isUnaryExpression,
  isMenmonicLiteral,
  isStringLiteral,
  Data,
  isAddress,
  isImmediateByteLiteral,
  isImmediateWordLiteral,
} from "../ls/generated/ast";

export const getExpressionSize = (expr: Expression): number => {
  if (isBinaryExpression(expr)) return Math.max(getExpressionSize(expr.left), getExpressionSize(expr.right));
  else if (isUnaryExpression(expr)) return 1;
  else if (isMenmonicLiteral(expr)) return 1;
  else if (isImmediateByteLiteral(expr)) return 1;
  else if (isImmediateWordLiteral(expr)) return 2;
  else if (isAddress(expr))
    return 2; // LabelReference | StarLiteral
  else if (isStringLiteral(expr)) return expr.value.length;
  else return 0;
};

export const getArgTypes = (argTypes: number[]) => {
  return argTypes
    .map((a) => {
      switch (a) {
        case 1:
          return "byte";
        case 2:
          return "zero-page";
        case 3:
          return "word";
        case 4:
          return "fast-jump";
      }
    })
    .join(",");
};

export class AsmCompileError extends Error {
  public range:
    | {
        start: { line: number; character: number };
        end: { line: number; character: number };
      }
    | undefined;
  public uri: string | undefined;

  constructor(message: string, node?: AstNode) {
    if (node) {
      const line = node.$cstNode?.range.start.line ?? 0;
      super(`${message} (line ${line})`);
      this.range = node.$cstNode?.range;
      this.uri = AstUtils.getDocument(node).uri.toString();
    } else {
      super(message);
    }
  }
}
