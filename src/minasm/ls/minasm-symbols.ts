import { type AstNode, type LangiumDocument, type MaybePromise } from "langium";
import { DefaultDocumentSymbolProvider } from "langium/lsp";
import { AstUtils } from "langium";
import {
  CancellationToken,
  DocumentSymbol,
  type DocumentSymbolParams,
} from "vscode-languageserver";

export class MinasmDocumentSymbolProvider extends DefaultDocumentSymbolProvider {
  getSymbols(
    document: LangiumDocument,
    _params: DocumentSymbolParams,
    _cancelToken?: CancellationToken,
  ): MaybePromise<DocumentSymbol[]> {
    const x = this.getSymbol(document, document.parseResult.value);
    return x.filter(
      (s): s is DocumentSymbol => s.name.endsWith("_end") === false,
    );
  }
}
