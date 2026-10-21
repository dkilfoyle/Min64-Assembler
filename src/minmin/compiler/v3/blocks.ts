import { LocalElement } from "../../ls/generated/ast";
import { compileStatement, out, format, cached } from "./compiler";
import { frameStack } from "./stack";

export function compileBlock(name: string, stmts: LocalElement[]) {
  format.indent += 2;
  cached.blockPath += "." + name;
  const newFrame = frameStack.addFrame(name, "block");
  stmts.forEach((stmt) => compileStatement(stmt));

  // epilog
  frameStack.printFrame();
  const curFrame = frameStack.pop()!;
  out(`${curFrame.name}_end:`, `block epilogue`);
  format.indent += 2;
  out(`AIV ${curFrame.frameSize},z_SP`, "Epilogue: pop locals off stack");
  format.indent -= 2;

  cached.blockPath = cached.blockPath.slice(
    0,
    cached.blockPath.lastIndexOf("."),
  );
  format.indent -= 2;
}
