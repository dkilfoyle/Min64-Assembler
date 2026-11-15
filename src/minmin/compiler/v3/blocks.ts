import { LocalElement } from "../../ls/generated/ast";
import { compileStatement, out, format } from "./compiler";
import { cached } from "./cache";
import { frameStack } from "./stack";
import { emitPreallocateStack } from "./functions";

export function compileBlock(name: string, stmts: LocalElement[]) {
  format.indent += 2;
  cached.unsetZA();
  frameStack.buildBlockFrame(name, stmts);
  frameStack.printFrame();
  emitPreallocateStack();
  stmts.forEach((stmt) => compileStatement(stmt));

  // epilog
  const curFrame = frameStack.pop()!;
  out(`${curFrame.name}_end:`, `block epilogue`);
  format.indent += 2;
  if (curFrame.frameSize > 0) out(`SIV ${curFrame.frameSize},z_SP`, "Epilogue: pop locals off stack");
  else out(`; No locals to pop off stack`, "Epilogue: no locals");
  format.indent -= 2;

  // cached.blockPath = cached.blockPath.slice(
  //   0,
  //   cached.blockPath.lastIndexOf("."),
  // );
  format.indent -= 2;
}
