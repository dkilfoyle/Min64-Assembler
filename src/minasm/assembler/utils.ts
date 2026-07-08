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
  else throw new Error(`Unknown data item type: ${expr}`);
};
