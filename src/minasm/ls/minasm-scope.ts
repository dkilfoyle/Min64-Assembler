import type { AstNode, AstNodeDescription, LangiumDocument, Scope } from "langium";
import { DefaultScopeComputation, DefaultScopeProvider, MultiMap } from "langium";
import { type MinasmServices } from "./minasm-module.js";
import { type Program } from "./generated/ast.js";

export class MinasmScopeComputation extends DefaultScopeComputation {
  constructor(services: MinasmServices) {
    super(services);
  }

  // protected override addLocalSymbol(node: AstNode, document: LangiumDocument, symbols: MultiMap<AstNode, AstNodeDescription>): void {
  //   const container = node.$container?.$container;
  //   if (container) {
  //     const name = this.nameProvider.getName(node);
  //     if (name) {
  //       symbols.add(container, this.descriptions.createDescription(node, name, document));
  //     }
  //   }
  // }

  override async collectExportedSymbols(document: LangiumDocument): Promise<AstNodeDescription[]> {
    // export all labels to global scope
    const descriptions: AstNodeDescription[] = [];
    const model = document.parseResult.value as Program;
    model.lines.forEach((line) => {
      if (line.label) descriptions.push(this.descriptions.createDescription(line.label!, line.label!.name));
    });
    return descriptions;
  }
}
