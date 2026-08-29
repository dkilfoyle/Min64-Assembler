import * as AST from "../ls/generated/ast.js";
import {
  isBinaryExpression,
  isBreakStatement,
  isCallStatement,
  isComparisonExpression,
  isDef,
  isFunctionCall,
  isIf,
  isPrintStatement,
  isReturnStatement,
  isUnaryExpression,
  isUse,
  isVariableAssignment,
  isVariableCalcAssignment,
  isVariableDeclaration,
  isVariableReference,
  isWhile,
} from "../ls/generated/ast.js";

export function computeReachableDefs(
  mainProgram: AST.Program,
  libraries: AST.Program[],
): AST.Def[] {
  const allDefs = new Map<string, AST.Def>();
  for (const prog of [...libraries, mainProgram]) {
    for (const el of prog.elements) {
      if (AST.isDef(el)) allDefs.set(el.name, el);
    }
  }

  const reachableDefs = new Map<string, AST.Def>();
  const visit = (elements: AST.GlobalElement[]): void => {
    for (const el of elements)
      walkForCalls(el, (name) => {
        if (reachableDefs.has(name)) return;
        reachableDefs.set(name, allDefs.get(name)!);
        const fn = allDefs.get(name);
        if (fn) visit(fn.block);
      });
  };
  visit(mainProgram.elements);
  return Array.from(reachableDefs.values());
}

/** Walks a statement/element (and everything nested inside it) looking for function calls,
 *  invoking `visit` with each called function's name. Used for reachability analysis. */
function walkForCalls(
  el: AST.GlobalElement,
  visit: (name: string) => void,
): void {
  const walkExpr = (e: AST.Expression): void => {
    switch (true) {
      case isFunctionCall(e):
        visit(e.functionName.$refText);
        for (const arg of e.args) for (const sub of arg.exprs) walkExpr(sub);
        return;
      case isBinaryExpression(e):
      case isComparisonExpression(e):
        walkExpr(e.left);
        walkExpr(e.right);
        return;
      case isUnaryExpression(e):
        walkExpr(e.inner);
        return;
      case isVariableReference(e):
        if (e.index?.startExpr) walkExpr(e.index.startExpr);
        if (e.index?.endExpr) walkExpr(e.index.endExpr);
        return;
      default:
        return;
    }
  };
  const walkCompound = (c: AST.CompoundExpression): void => {
    for (const e of c.exprs) walkExpr(e);
  };

  switch (true) {
    case isVariableDeclaration(el):
      if (el.atExpr) walkExpr(el.atExpr);
      if (el.assignExpr) walkCompound(el.assignExpr);
      return;
    case isVariableAssignment(el):
      if (el.indexExpr) walkExpr(el.indexExpr);
      walkCompound(el.assignExpr);
      return;
    case isVariableCalcAssignment(el):
      if (el.indexExpr) walkExpr(el.indexExpr);
      return;
    case isFunctionCall(el):
      visit(el.functionName.$refText);
      for (const arg of el.args) walkCompound(arg);
      return;
    case isReturnStatement(el):
      walkCompound(el.expr);
      return;
    case isPrintStatement(el):
      for (const arg of el.args) walkCompound(arg);
      return;
    case isBreakStatement(el):
    case isCallStatement(el):
    case isUse(el):
    case isDef(el):
      return;
    case isIf(el):
      walkExpr(el.condition);
      for (const s of el.block) walkForCalls(s, visit);
      for (const e of el.elifs) {
        walkExpr(e.condition);
        for (const s of e.block) walkForCalls(s, visit);
      }
      if (el.elseBlock)
        for (const s of el.elseBlock.block) walkForCalls(s, visit);
      return;
    case isWhile(el):
      walkExpr(el.condition);
      for (const s of el.block) walkForCalls(s, visit);
      return;
  }
}
