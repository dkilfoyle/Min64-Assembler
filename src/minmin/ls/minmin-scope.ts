// import type { AstNode, AstNodeDescription, LangiumDocument, Scope } from "langium";
// import { DefaultScopeComputation, DefaultScopeProvider, MultiMap } from "langium";
// import { type MinasmServices } from "./minasm-module.js";
// import { isLabel, type Program } from "./generated/ast.js";

// export class MinasmScopeComputation extends DefaultScopeComputation {
//   constructor(services: MinasmServices) {
//     super(services);
//   }

//   override async collectExportedSymbols(document: LangiumDocument): Promise<AstNodeDescription[]> {
//     // export all labels to global scope
//     const descriptions: AstNodeDescription[] = [];
//     const model = document.parseResult.value as Program;
//     model.entries.forEach((entry) => {
//       if (isLabel(entry)) descriptions.push(this.descriptions.createDescription(entry, entry.name));
//     });
//     return descriptions;
//   }
// }

// Not needed if Label is sibling of Data
// eg
// Entry:
//   Label | Data;
// don't use
// Entry:
//  label=Label | data=Data;
