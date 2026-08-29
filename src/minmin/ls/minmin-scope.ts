import {
  DefaultScopeProvider,
  type ReferenceInfo,
  type Scope,
  AstUtils,
  stream,
  MapScope,
  type LangiumDocuments,
} from "langium";
import { Program, isDef, isProgram, isUse } from "./generated/ast.js";
import { resolveImportUri } from "./minmin-import-utils.js";

export class MinminScopeProvider extends DefaultScopeProvider {
  protected readonly documents: LangiumDocuments;

  constructor(services: any) {
    super(services);
    // Grab the documents service to find parsed workspace files by URI
    this.documents = services.shared.workspace.LangiumDocuments;
  }

  override getScope(context: ReferenceInfo): Scope {
    // Intercept function calls to look up only in explicitly imported files
    if (
      context.property === "functionName" &&
      context.container.$type === "FunctionCall"
    ) {
      const rootModel = AstUtils.getDocument(context.container).parseResult
        .value as Program;
      const visibleDescriptions: any[] = [];

      // 1. Always include functions declared inside the CURRENT file
      const localElements = rootModel.elements || [];
      for (const func of localElements.filter((e) => isDef(e))) {
        visibleDescriptions.push(
          this.descriptions.createDescription(func, func.name),
        );
      }

      // 2. Resolve paths from 'use "std.min"' statements
      const currentUri = AstUtils.getDocument(context.container).uri;

      for (const imp of localElements.filter((e) => isUse(e))) {
        if (!imp.libPath) continue;

        // Resolve the relative path against the current file's directory location
        // e.g., if current file is 'file:///src/main.txt', 'std.min' becomes 'file:///src/std.min'
        const importedUri = resolveImportUri(currentUri, imp.libPath);
        console.log(
          `Resolved import path: ${imp.libPath} -> ${importedUri.toString()}`,
        );

        // If the imported file is already loaded in the workspace, add its functions to the visible scope

        if (this.documents.hasDocument(importedUri)) {
          const importedDoc = this.documents.getDocument(importedUri);
          if (importedDoc) {
            const importedModel = importedDoc.parseResult.value as Program;

            if (isProgram(importedModel) && importedModel.elements) {
              for (const func of importedModel.elements.filter((e) =>
                isDef(e),
              )) {
                visibleDescriptions.push(
                  this.descriptions.createDescription(func, func.name),
                );
              }
            }
          }
        }
      }

      // Return a localized map scope containing only current + explicitly imported symbols
      return new MapScope(stream(visibleDescriptions));
    }

    // Fall back to default behavior for any other cross-references
    return super.getScope(context);
  }
}
