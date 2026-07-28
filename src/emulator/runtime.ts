import { type WebviewPanel } from "vscode";
import { Messenger } from "vscode-messenger";
import { BROADCAST } from "vscode-messenger-common";
import type { NotificationType, RequestType, WebviewIdMessageParticipant } from "vscode-messenger-common";
import type { IEmulationState } from "../../packages/emulator/src/emulator/cpu";
import { hexNotificationType, runRequestType, type RunTypes } from "../../packages/emulator/src/messageTypes";
// import { Messenger } from "./messenger";

const messenger = new Messenger();

class Runtime {
  emulationState: IEmulationState | null = null;
  constructor() {}

  registerWebviewPanel(panel: WebviewPanel) {
    messenger.registerWebviewPanel(panel);
  }

  public run(runType: RunTypes) {
    messenger.sendRequest(runRequestType, BROADCAST, runType).then((state: IEmulationState) => {
      this.emulationState = state;
    });
  }

  public loadHex(hex: string) {
    messenger.sendNotification(hexNotificationType, { type: "webview", webviewType: "emulatorPanel" }, hex);
  }

  public setBreakpoint() {}
  public removeBreakpoint() {}
}

export const runtime = new Runtime();
