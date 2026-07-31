import { type WebviewPanel } from "vscode";
import { Messenger } from "vscode-messenger";
import type { IEmulationState } from "../../packages/emulator/src/emulator11/machine";
import { MinAsmDebugSession } from "../debugger/MinAsmDebugSession";
import type { AsmCompileResult } from "../minasm/worker/api";
import { useDocStore } from "../store/myStore";
import { OutputEvent, StoppedEvent, TerminatedEvent } from "../debugger/dap/events";
import * as vscode from "vscode";
import { RunNotification, type IRunParams } from "../../packages/emulator/src/api";

const messenger = new Messenger();

interface IAsmBreakpoint {
  id: number;
  line: number;
  verified: boolean;
}

export interface IStackFrame {
  index: number;
  name: string;
  file: string;
  line: number;
  stackBase: number;
  stackLabels: Record<string, string>;
}

type IStepMode = "stepInto" | "stepOut" | "stepOver" | "continue";
type IStepResult = IStepMode | "stop";

class Runtime {
  emulationState: IEmulationState | null = null;
  private debugSession: MinAsmDebugSession | null = null;
  compileResult: AsmCompileResult | null = null;
  public frames: IStackFrame[] = [];

  constructor() {}

  registerWebviewPanel(panel: WebviewPanel) {
    messenger.registerWebviewPanel(panel);
  }

  registerDebugSession(session: MinAsmDebugSession) {
    this.debugSession = session;
  }

  setCurrentLine() {
    if (!this.emulationState) throw Error("No emulation state");
    const pc = this.emulationState.pc;
    if (!this.compileResult) throw Error("No compile result");
    this.frames[0].line = this.compileResult.locations[pc].start.line;
    this.frames[0].file = this.compileResult.uri;
  }

  setSource(source: string) {
    const result = useDocStore.getState().compiledAsm[source];
    if (!result) throw Error("unable to get compiled asm for source " + source);
    this.compileResult = result;
    this.run({ runType: "stop", pc: 0x100, hex: result.hex });
  }

  public run(runParams: IRunParams) {
    messenger.sendNotification(RunNotification, { type: "webview", webviewType: "emulatorPanel" }, runParams);
  }

  public setBreakpoint() {}
  public removeBreakpoint() {}

  start(path: string, stopOnEntry: boolean) {
    if (!this.debugSession) throw Error("No debug session set");
    if (!this.compileResult) throw Error("No source");

    // this.runUntilReturnFrom = "";
    // this.isDebugging = true;

    this.frames = [
      {
        index: 0,
        file: this.compileResult.uri,
        line: 0,
        name: "entry",
        stackBase: 0x0140 - 1, // ugly hack, TODO: set to mem.size or config.initialStackBase
        stackLabels: {},
      },
    ];

    // this.log(`Asm runtime start uri=${this.compileResult.uri}`);

    this.setCurrentLine();
    this.stop("entry", `Runtime started`);
  }

  stop(type: "step" | "hlt" | "breakpoint" | "entry", output: string): IStepResult {
    switch (type) {
      case "entry":
        this.debugSession!.sendEvent(new StoppedEvent("entry", MinAsmDebugSession.THREAD_ID));
        break;
      case "step":
        this.debugSession!.sendEvent(new StoppedEvent("step", MinAsmDebugSession.THREAD_ID));
        break;
      case "hlt":
        this.debugSession!.sendEvent(new TerminatedEvent());
        // this.isDebugging = false;
        vscode.commands.executeCommand("workbench.view.explorer");
        break;
      case "breakpoint":
        this.debugSession!.sendEvent(new StoppedEvent("breakpoint", MinAsmDebugSession.THREAD_ID));
        break;
    }
    this.debugSession!.sendEvent(new OutputEvent(`${output}\n`));
    return "stop";
  }
}

export const runtime = new Runtime();
