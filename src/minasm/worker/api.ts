import { RequestType } from "vscode-languageserver-protocol";
import type { ILabelLocation, IPCLocation } from "../assembler/assembler";

export interface AsmCompileParams {
  uri: string;
}

export interface AsmCompileResult {
  uri: string;
  hex: string;
  locations: Record<number, IPCLocation>;
  labels: Record<string, ILabelLocation>;
}

export const AsmCompileRequest = new RequestType<AsmCompileParams, AsmCompileResult, void>("app/minasm-compile");
