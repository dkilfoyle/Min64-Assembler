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
