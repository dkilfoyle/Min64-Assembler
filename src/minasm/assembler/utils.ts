import {
  Expression,
  isBinaryExpression,
  isUnaryExpression,
  isMenmonicLiteral,
  Instruction,
  isStringLiteral,
  Data,
  isAddress,
  isImmediateByteLiteral,
  isImmediateWordLiteral,
} from "../ls/generated/ast";

export const getExpressionSize = (expr: Expression, isLSB: boolean): number => {
  if (isBinaryExpression(expr)) return Math.max(getExpressionSize(expr.left, isLSB), getExpressionSize(expr.right, isLSB));
  else if (isUnaryExpression(expr)) return 1;
  else if (isMenmonicLiteral(expr)) return 1;
  else if (isImmediateByteLiteral(expr)) return 1;
  else if (isImmediateWordLiteral(expr)) return isLSB ? 1 : 2;
  else if (isAddress(expr)) return isLSB ? 1 : 2;
  else if (isStringLiteral(expr)) return expr.value.length;
  else throw new Error(`Unknown data item type: ${expr}`);
};

export const getDataSize = (data: Data, isLSB = false): number => {
  let size = 0;
  for (const expr of data.items) {
    size += getExpressionSize(expr, isLSB);
  }
  return size;
};
