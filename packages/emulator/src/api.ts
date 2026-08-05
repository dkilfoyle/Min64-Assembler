import type { IEmulationState } from "./emulator14/machine";
import type { NotificationType, RequestType } from "vscode-messenger-common";

export type RunTypes = "run" | "stop" | "reset" | "continue";
export type StepTypes = "stepInto" | "stepOver" | "stepOut";

export interface IRunParams {
  runType: RunTypes;
  hex?: string;
  pc?: number;
  reset?: boolean;
}

export interface IStepParams {
  stepType: StepTypes;
  nextPC?: number;
}

export const RunNotification: NotificationType<IRunParams> = { method: "minasm/run" };
export const BreakpointsNotification: NotificationType<number[]> = { method: "minasm/breakpoints" };
export const EmulationStateRequest: RequestType<void, IEmulationState> = { method: "minasm/getEmulationState" };
export const StepRequest: RequestType<IStepParams, IEmulationState> = { method: "minasm/step" };
