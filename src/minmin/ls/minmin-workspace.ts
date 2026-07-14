import { type AstNode, DefaultWorkspaceManager, type LangiumDocument, type LangiumDocumentFactory } from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import { WorkspaceFolder } from "vscode-languageserver";
import { URI } from "vscode-uri";
import stdLib from "../examples/std.min?raw";

export class MinminWorkspaceManager extends DefaultWorkspaceManager {
  private documentFactory: LangiumDocumentFactory;

  constructor(services: LangiumSharedServices) {
    super(services);
    this.documentFactory = services.workspace.LangiumDocumentFactory;
  }

  protected override async loadAdditionalDocuments(
    folders: WorkspaceFolder[],
    collector: (document: LangiumDocument<AstNode>) => void,
  ): Promise<void> {
    await super.loadAdditionalDocuments(folders, collector);
    // Load our library using the `builtin` URI schema
    // collector(this.documentFactory.fromString(stdLib, URI.parse("builtin:///std.min")));
  }
}
