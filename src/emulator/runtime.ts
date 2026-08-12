import { SourceBreakpoint, type WebviewPanel } from "vscode";
import { Messenger } from "vscode-messenger";
import type { IEmulationState } from "../../packages/emulator/src/emulator14/machine";
import { MinAsmDebugSession } from "../debugger/MinAsmDebugSession";
import type { AsmCompileResult } from "../minasm/worker/api";
import { useDocStore } from "../store/myStore";
import {
  OutputEvent,
  StoppedEvent,
  TerminatedEvent,
} from "../debugger/dap/events";
import {
  BreakpointsNotification,
  EmulationStateRequest,
  MemoryViewerNotification,
  RunNotification,
  StepRequest,
  type IStepParams,
} from "../../packages/emulator-react/src/api";
import * as vscode from "vscode";
import { type IRunParams } from "../../packages/emulator-react/src/api";
import { osLocations } from "./osLocations";

const messenger = new Messenger();

interface IRuntimeBreakpoint {
  pc: number;
}

interface ISourcePosition {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface IStackFrame {
  name: string;
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  stackBase: number;
}

type IStepMode = "stepInto" | "stepOut" | "stepOver" | "continue";
type IStepResult = IStepMode | "stop";

class Runtime {
  emulationState: IEmulationState | null = null;
  private debugSession: MinAsmDebugSession | null = null;
  compileResult: AsmCompileResult | null = null;
  public stack: IStackFrame[] = [];
  breakpoints: Map<string, number[]> = new Map();

  constructor() {}

  registerWebviewPanel(panel: WebviewPanel) {
    messenger.registerWebviewPanel(panel);
  }

  registerDebugSession(session: MinAsmDebugSession) {
    this.debugSession = session;
  }

  async updateState() {
    if (!this.compileResult) throw Error("No compile result");
    this.emulationState = await messenger.sendRequest(EmulationStateRequest, {
      type: "webview",
      webviewType: "emulatorPanel",
    });
    const pc = this.emulationState.pc;
    const loc = this.compileResult.locations[pc];
    if (loc) {
      this.stack[0].line = loc.line;
      this.stack[0].column = loc.column;
      this.stack[0].endLine = loc.endLine;
      this.stack[0].endColumn = loc.endColumn;
      this.stack[0].path = this.compileResult.uri;
      return true;
    }

    const osloc = osLocations[pc];
    if (osloc) {
      this.stack[0].line = osloc.line;
      this.stack[0].column = osloc.column;
      this.stack[0].endLine = osloc.endLine;
      this.stack[0].endColumn = osloc.endColumn;
      this.stack[0].path = "builtin:/os.asm";
      return true;
    }

    console.warn(`No source location for pc=${pc.toString(16)}`);
    return false;
  }

  setSource(source: string, stopOnEntry: boolean) {
    const result = useDocStore.getState().compiledAsm[source];
    if (!result) {
      console.log(source, useDocStore.getState().compiledAsm);
      throw Error("unable to get compiled asm for source " + source);
    }
    this.compileResult = result;
    console.log("Runtime setSource", source, stopOnEntry, result);
    this.run({
      runType: stopOnEntry ? "stop" : "run",
      pc: result.startAddress,
      hex: result.hex,
      reset: true,
      locations: result.locations,
    });
  }

  public showMemory(memoryReference: string) {
    console.log("Runtime showMemory", memoryReference);
    messenger.sendNotification(
      MemoryViewerNotification,
      { type: "webview", webviewType: "emulatorPanel" },
      { startAddress: parseInt(memoryReference, 16) },
    );
  }

  public run(runParams: IRunParams) {
    messenger.sendNotification(
      RunNotification,
      { type: "webview", webviewType: "emulatorPanel" },
      runParams,
    );
  }

  public async step(stepParams: IStepParams) {
    if (!this.compileResult) throw Error("No source");
    if (!this.emulationState) throw Error("No emulation state");
    const nextPC =
      stepParams.stepType == "stepOver"
        ? this.compileResult.locations[this.emulationState.pc]?.nextPC
        : undefined;

    this.emulationState = await messenger.sendRequest(
      StepRequest,
      { type: "webview", webviewType: "emulatorPanel" },
      { ...stepParams, nextPC },
    );

    console.log("Runtime step", stepParams, nextPC, this.emulationState);

    if (this.emulationState.pc == 0xf135) {
      this.stop("hlt");
    } else {
      this.stop("step");
    }
  }

  public setBreakpoints(path: string) {
    const bps = this.breakpoints.get(path);
    if (!bps) return;
    messenger.sendNotification(
      BreakpointsNotification,
      { type: "webview", webviewType: "emulatorPanel" },
      bps,
    );
  }

  getMemory(memoryReference: string) {
    if (!this.emulationState) throw Error("No emulation state");
    return Array.from(
      this.emulationState.memory.slice(
        parseInt(memoryReference, 16),
        parseInt(memoryReference, 16) + 256,
      ),
    );
  }

  start(stopOnEntry: boolean) {
    console.log("Runtime start", stopOnEntry);
    if (!this.debugSession) throw Error("No debug session set");
    if (!this.compileResult) throw Error("No source");

    // this.runUntilReturnFrom = "";
    // this.isDebugging = true;

    this.stack = [
      {
        path: this.compileResult.uri,
        line: 0,
        column: 0,
        endLine: 0,
        endColumn: 0,
        name: "global",
        stackBase: 0xfe,
      },
    ];

    // this.log(`Asm runtime start uri=${this.compileResult.uri}`);

    if (stopOnEntry) {
      this.stop("entry", `Runtime started`);
    }
  }

  async stop(
    type: "step" | "hlt" | "breakpoint" | "entry",
    output?: string,
  ): Promise<IStepResult> {
    const more = await this.updateState();
    if (!more) type = "hlt";
    switch (type) {
      case "entry":
        this.debugSession!.sendEvent(
          new StoppedEvent("entry", MinAsmDebugSession.THREAD_ID),
        );
        break;
      case "step":
        this.debugSession!.sendEvent(
          new StoppedEvent("step", MinAsmDebugSession.THREAD_ID),
        );
        break;
      case "hlt":
        console.log("Runtime stop: hlt");
        this.debugSession!.sendEvent(new TerminatedEvent());
        this.run({ runType: "run" }); // let the emulator carry on running until it stops naturally, so that the user can see the final state of the program
        // this.isDebugging = false;
        vscode.commands.executeCommand("workbench.view.explorer");
        break;
      case "breakpoint":
        this.debugSession!.sendEvent(
          new StoppedEvent("breakpoint", MinAsmDebugSession.THREAD_ID),
        );
        break;
    }
    if (output) {
      this.debugSession!.sendEvent(new OutputEvent(`${output}\n`));
    }
    return "stop";
  }
}

export const runtime = new Runtime();
