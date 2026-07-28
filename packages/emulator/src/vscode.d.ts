// export {};

// declare global {
//   interface PresetVsCodeApi<T = unknown> {
//     postMessage(message: unknown): void;
//     getState(): T | undefined;
//     setState(state: T): T;
//   }

//   function acquireVsCodeApi<T = unknown>(): PresetVsCodeApi<T>;
// }

declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};
