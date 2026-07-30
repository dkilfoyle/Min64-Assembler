import type { IEmulationState } from "./emulator/computer";
import type { NotificationType, RequestType } from "vscode-messenger-common";

export type RunTypes = "run" | "stepInto" | "stepOver" | "stepOut" | "debugRun" | "stop" | "reset";

export interface IRunParams {
  runType: RunTypes;
  hex?: string;
  pc?: number;
}

export const RunNotification: NotificationType<IRunParams> = { method: "minasm/run" };
export const EmulationStateRequest: RequestType<void, IEmulationState> = { method: "minasm/getEmulationState" };
