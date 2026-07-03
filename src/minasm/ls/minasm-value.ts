import { DefaultValueConverter, type CstNode, type ValueType } from "langium";
import { GrammarAST } from "langium";

export class MinasmConverter extends DefaultValueConverter {
  protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode): ValueType {
    // Intercept your custom CHAR terminal rule
    if (rule.name === "CHAR") {
      return input.slice(1, -1); // Remove the surrounding single quotes
    }

    // Fall back to default behavior for INT, STRING, ID, etc.
    return super.runConverter(rule, input, cstNode);
  }
}
