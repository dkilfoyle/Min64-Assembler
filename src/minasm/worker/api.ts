import { RequestType } from "vscode-languageserver-protocol";

export interface SourceLocation {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface AsmCompileParams {
  uri: string;
}

export interface AsmCompileResult {
  uri: string;
  hex: string;
  // JSON-RPC friendly types instead of Map
  locations: Record<number, SourceLocation>;
  labels: Record<string, { address: number; sourceLocation: SourceLocation }>;
}

export const AsmCompileRequest = new RequestType<AsmCompileParams, AsmCompileResult, void>("app/minasm-compile");
