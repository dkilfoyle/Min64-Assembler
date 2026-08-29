import { DocumentState, type LangiumDocument } from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import { isProgram, isUse } from "./generated/ast.js";
import { resolveImportUri } from "./minmin-import-utils.js";

/**
 * Fetches files referenced via `use "..."` before linking runs, since the
 * synchronous ScopeProvider can't perform an async file read itself.
 */
export class MinminImportLoader {
  private readonly services: LangiumSharedServices;

  constructor(services: LangiumSharedServices) {
    this.services = services;
    services.workspace.DocumentBuilder.onBuildPhase(
      DocumentState.IndexedContent,
      async (documents) => {
        await this.loadMissingImports(documents);
      },
    );
  }

  private async loadMissingImports(
    documents: readonly LangiumDocument[],
  ): Promise<void> {
    const langiumDocuments = this.services.workspace.LangiumDocuments;
    for (const doc of documents) {
      const program = doc.parseResult.value;
      if (!isProgram(program)) continue;

      for (const use of (program.elements ?? []).filter((e) => isUse(e))) {
        if (!use.libPath) continue;
        const importedUri = resolveImportUri(doc.uri, use.libPath);
        if (langiumDocuments.hasDocument(importedUri)) continue;

        try {
          await langiumDocuments.getOrCreateDocument(importedUri);
        } catch {
          // Missing/unreadable file: the reference stays unresolved and is reported as a linking error.
        }
      }
    }
  }
}
