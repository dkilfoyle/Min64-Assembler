import type { IEmulationState } from "./emulator/cpu";
import type { NotificationType, RequestType } from "vscode-messenger-common";

export type RunTypes = "run" | "stepInto" | "stepOver" | "stepOut" | "debugRun";

export const runRequestType: RequestType<RunTypes, IEmulationState> = { method: "run" };
export const hexNotificationType: NotificationType<string> = { method: "loadHex" };
