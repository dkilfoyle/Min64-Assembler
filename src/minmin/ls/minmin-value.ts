import { DefaultValueConverter, type CstNode, type ValueType } from "langium";
import { GrammarAST } from "langium";

export class MinminConverter extends DefaultValueConverter {
  protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode): ValueType {
    // Intercept your custom CHAR terminal rule
    // if (rule.name === "CHAR") {
    //   return input.slice(1, -1); // Remove the surrounding single quotes
    // }
    if (rule.name == "LABELID") {
      return input.slice(0, -1);
    }

    if (rule.name == "CHAR") {
      // strip surround quotations from a CHAR literal, preserving possibility of control chars such as \n
      // the super fallback below strips quotations from STRING literals
      if (input == `"\\n"`) return "\n";
      const result = input.replace(/^(["'])(.)\1$/s, "$2");
      return result;
    }

    // Fall back to default behavior for INT, STRING, ID, etc.
    return super.runConverter(rule, input, cstNode);
  }
}
