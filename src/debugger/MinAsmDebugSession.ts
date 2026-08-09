/* eslint-disable @typescript-eslint/no-unused-vars */
import type { IEmulationState } from "../../packages/emulator/src/emulator14/machine";
import { runtime } from "../emulator/runtime";
import type { AsmCompileResult } from "../minasm/worker/api";
import { DebugSession, ErrorDestination } from "./dap/DebugSession";
import { Handles } from "./dap/Handles";
import { Subject } from "./dap/await-notify";
import { InitializedEvent, TerminatedEvent } from "./dap/events";
import { Breakpoint, Scope, Source, StackFrame, Thread } from "./dap/features";
import type { DebugProtocol } from "@vscode/debugprotocol";

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  /** An absolute path to the "program" to debug. */
  path: string;
  /** Automatically stop target after launch. If not specified, target does not stop. */
  stopOnEntry?: boolean;
  /** enable logging the Debug Adapter Protocol */
  trace?: boolean;
}

const hex8 = (n: number) => "0x" + n.toString(16).padStart(2, "0");
const hex16 = (n: number) => "0x" + n.toString(16).padStart(4, "0");

/*
Debug Adapter Protocol (DAP) sequence of events:
- InitializeRequest
  - respond with capabilities
  - send InitializedEvent
    - setBreakpointsRequest
      - respond with verified breakpoints
    - configurationDoneRequest
      - respond

*/

export class MinAsmDebugSession extends DebugSession {
  public static THREAD_ID = 1;
  private _variableHandles = new Handles<string>();
  private _cancelationTokens = new Map<number, boolean>();

  private _configurationDone = new Subject();
  constructor() {
    super(false); // true for logging of request/response
    this.setDebuggerLinesStartAt1(false);
    this.setDebuggerColumnsStartAt1(false);
    runtime.registerDebugSession(this);
  }

  getEmulationState(response: DebugProtocol.Response) {
    const es = runtime.emulationState;
    if (!es) {
      this.sendErrorResponse(response, 1002, "No emulation state");
    }
    return es;
  }

  getCompileState(response: DebugProtocol.Response) {
    const cr = runtime.compileResult;
    if (!cr) {
      this.sendErrorResponse(response, 1002, "No compile result");
    }
    return cr;
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, _args: DebugProtocol.InitializeRequestArguments): void {
    console.log("initializeRequest", _args);
    response.body = response.body || {};
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsEvaluateForHovers = true;
    // response.body.supportsStepBack = true;
    // response.body.supportsDataBreakpoints = true;
    // response.body.supportsCompletionsRequest = true;
    // response.body.completionTriggerCharacters = [".", "["];
    // response.body.supportsCancelRequest = true;
    // response.body.supportsBreakpointLocationsRequest = true;
    response.body.supportsReadMemoryRequest = true;

    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
    super.configurationDoneRequest(response, args);
    this._configurationDone.notify();
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
    // make sure to 'Stop' the buffered logging if 'trace' is not set
    // logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);
    console.log("launchRequest", args);

    try {
      runtime.setSource(args.path, !!args.stopOnEntry);
    } catch (e) {
      const errorResponse = response as DebugProtocol.ErrorResponse;
      errorResponse.success = false;
      errorResponse.message = (e as Error).message;
      this.sendResponse(errorResponse);
      return;
    }

    // wait until configuration has finished (and configurationDoneRequest has been called)
    await this._configurationDone.wait(1000);

    // start the program in the runtime
    runtime.start(!!args.stopOnEntry);

    this.sendResponse(response);
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // runtime supports no threads so just return a default thread.
    response.body = {
      threads: [new Thread(MinAsmDebugSession.THREAD_ID, "thread 1")],
    };
    this.sendResponse(response);
  }

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
    console.log("setBreakPointsRequest", args);
    const path = args.source.path;
    if (!path) throw new Error("no path");
    const cs = this.getCompileState(response); // ensure we have a compile state
    if (!cs) return;
    const clientbps = args.breakpoints || [];
    runtime.breakpoints.set(path, []);

    // set and verify breakpoint locations
    const actualBreakpoints = clientbps.map((bp) => {
      // calculate the PC @ the breakpoint
      const valid = Object.entries(cs.locations).find(([pc, loc]) => {
        if (loc.line == bp.line) {
          if (bp.column == undefined) {
            return true;
          } else {
            return loc.column == bp.column;
          }
        }
      });
      if (valid) {
        runtime.breakpoints.get(path)!.push(parseInt(valid[0]));
      }
      const breakpoint = new Breakpoint(true, bp.line, bp.column);
      // breakpoint.setId(id);
      return breakpoint;
    });

    // send back the actual breakpoint positions
    response.body = {
      breakpoints: actualBreakpoints,
    };
    this.sendResponse(response);
  }

  protected breakpointLocationsRequest(
    response: DebugProtocol.BreakpointLocationsResponse,
    args: DebugProtocol.BreakpointLocationsArguments,
    request?: DebugProtocol.Request,
  ): void {
    const cs = this.getCompileState(response); // ensure we have a compile state
    if (!cs) return;
    if (args.source.path) {
      response.body = {
        breakpoints: Object.values(cs.locations).filter((loc) => {
          if (args.endLine != undefined && loc.endLine > args.endLine) return false;
          if (loc.line < args.line) return false;
          if (args.endColumn != undefined && loc.endColumn > args.endColumn) return false;
          if (args.column != undefined && loc.column < args.column) return false;
          return true;
        }),
      };
    } else {
      response.body = {
        breakpoints: [],
      };
    }
    this.sendResponse(response);
  }

  protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, _args: DebugProtocol.StackTraceArguments): void {
    // const startFrame = typeof args.startFrame === "number" ? args.startFrame : 0;
    // const maxLevels = typeof args.levels === "number" ? args.levels : 1000;
    // const endFrame = startFrame + maxLevels;
    console.log("stackTraceRequest", _args, runtime.stack);
    response.body = {
      stackFrames: runtime.stack.map((f, i) => ({
        id: i,
        column: f.column,
        endColumn: f.endColumn,
        line: f.line,
        endLine: f.endLine,
        source: this.createSource(f.path),
        name: f.name,
      })),
      totalFrames: runtime.stack.length,
    };
    this.sendResponse(response);
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, _args: DebugProtocol.ScopesArguments): void {
    response.body = {
      scopes: [
        new Scope("Registers", this._variableHandles.create("Registers"), false),
        new Scope("Pointers", this._variableHandles.create("Pointers"), false),
        new Scope("Labels (file)", this._variableHandles.create("Labels"), true),
      ],
    };
    this.sendResponse(response);
  }

  protected async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
    _request?: DebugProtocol.Request,
  ) {
    const es = this.getEmulationState(response);
    if (!es) return;
    const cs = this.getCompileState(response);
    if (!cs) return;

    const variables: DebugProtocol.Variable[] = [];

    const id = this._variableHandles.get(args.variablesReference);

    if (id == "Registers") {
      const pcLabel = Object.entries(cs.labels).find(([label, info]) => info.address == es.pc);
      variables.push({
        name: "pc",
        type: "integer",
        value: `${hex16(es.pc)}, ${pcLabel ? pcLabel[0] : ""}`,
        variablesReference: 0,
      });
      variables.push({
        name: "a",
        type: "integer",
        value: `${hex8(es.a)}, ${es.a}`,
        variablesReference: 0,
      });
      variables.push({
        name: "n",
        type: "boolean",
        value: `${es.n.toString()}`,
        variablesReference: 0,
      });
      variables.push({
        name: "c",
        type: "boolean",
        value: `${es.c.toString()}`,
        variablesReference: 0,
      });
      variables.push({
        name: "z",
        type: "boolean",
        value: `${es.z.toString()}`,
        variablesReference: 0,
      });
      variables.push({
        name: "sp",
        type: "integer",
        value: `${hex8(es.sp)}, ${es.sp}`,
        variablesReference: 0,
      });
    } else if (id == "Labels") {
      Object.entries(cs.labels).forEach(([labelname, labelinfo]) => {
        variables.push({
          name: labelname,
          type: "integer",
          value: `${hex16(labelinfo.address)}`,
          variablesReference: 0,
        });
      });
    } else if (id == "Pointers") {
      variables.push({
        name: "z0",
        type: "integer",
        value: `${hex8(es.memory[0x90])}, ${es.memory[0x90]}`,
        variablesReference: 0,
      });
      variables.push({
        name: "z1",
        type: "integer",
        value: `${hex8(es.memory[0x91])}, ${es.memory[0x91]}`,
        variablesReference: 0,
      });
      variables.push({
        name: "z2",
        type: "integer",
        value: `${hex8(es.memory[0x92])}, ${es.memory[0x92]}`,
        variablesReference: 0,
      });
      variables.push({
        name: "z3",
        type: "integer",
        value: `${hex8(es.memory[0x93])}, ${es.memory[0x93]}`,
        variablesReference: 0,
      });
    }

    response.body = {
      variables: variables,
    };
    this.sendResponse(response);
  }

  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments,
    request?: DebugProtocol.Request,
  ): void {
    let result = "";
    if (args.context == "hover") {
      // could be a label
      const cs = this.getCompileState(response);
      if (!cs) return;
      const es = this.getEmulationState(response);
      if (!es) return;
      const label = cs.labels[args.expression];
      if (label) {
        result = ` ${args.expression}: ${hex16(label.address)} = ${hex8(es.memory[label.address])}`;
      } else {
        return this.sendResponse(response);
      }
    }
    response.body = {
      result,
      variablesReference: 0,
    };
    this.sendResponse(response);
  }

  protected readMemoryRequest(
    response: DebugProtocol.ReadMemoryResponse,
    args: DebugProtocol.ReadMemoryArguments,
    request?: DebugProtocol.Request,
  ): void {
    response.body = {
      address: args.memoryReference,
      data: btoa(String.fromCharCode.apply(null, runtime.getMemory(args.memoryReference))),
    };
    this.sendResponse(response);
  }

  protected async continueRequest(response: DebugProtocol.ContinueResponse, _args: DebugProtocol.ContinueArguments): Promise<void> {
    await runtime.step({ stepType: "continue" });
    this.sendResponse(response);
  }

  protected async nextRequest(response: DebugProtocol.NextResponse, _args: DebugProtocol.NextArguments): Promise<void> {
    await runtime.step({ stepType: "stepOver" });
    this.sendResponse(response);
  }

  protected async stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments,
    _request?: DebugProtocol.Request,
  ): Promise<void> {
    await runtime.step({ stepType: "stepInto" });
    this.sendResponse(response);
  }

  protected async stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments,
    _request?: DebugProtocol.Request,
  ): Promise<void> {
    await runtime.step({ stepType: "stepOut" });
    this.sendResponse(response);
  }

  protected cancelRequest(_response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
    if (args.requestId) {
      this._cancelationTokens.set(args.requestId, true);
    }
  }

  protected async terminateRequest(response: DebugProtocol.TerminateResponse, _args: DebugProtocol.TerminateArguments): Promise<void> {
    console.log("terminateRequest");
    this.sendResponse(response);
    this.sendEvent(new TerminatedEvent());
    runtime.run({ runType: "run" }); // let the emulator carry on running until it stops naturally, so that the user can see the final state of the program
  }

  private createSource(filePath: string): Source {
    const name = filePath.slice(filePath.lastIndexOf("/") + 1);
    const path = filePath.replace("file://", "");
    return new Source(name, path, undefined, undefined, undefined);
  }
}
