import { RequestType } from "vscode-languageserver-protocol";

export interface MinCompileParams {
  uri: string;
}

export interface MinCompileResult {
  uri: string;
  asm: string;
  status: "ok" | "error";
  errors: string[];
}

export const MinCompileRequest = new RequestType<
  MinCompileParams,
  MinCompileResult,
  void
>("app/minmin-compile");

export interface MinReadFileParams {
  uri: string;
}

export interface MinReadFileResult {
  content: string;
}

// Lets the worker's Langium services read files from the main thread's virtual
// filesystem (Monaco's RegisteredFileSystemProvider), which the worker can't access directly.
export const MinReadFileRequest = new RequestType<
  MinReadFileParams,
  MinReadFileResult,
  void
>("app/minmin-readFile");

