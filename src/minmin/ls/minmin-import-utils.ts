import { URI, Utils } from "vscode-uri";

// Joins (not string-concats) so scheme/encoding stays intact for non-file URIs.
export function resolveImportUri(currentUri: URI, libPath: string): URI {
  return Utils.joinPath(Utils.dirname(currentUri), libPath);
}
