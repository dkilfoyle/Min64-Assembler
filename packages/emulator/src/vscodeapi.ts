// // vscode-api.ts
// interface VSCodeApi {
//   postMessage(message: unknown): void;
//   getState(): unknown;
//   setState<T>(state: T): void;
// }

// if (typeof acquireVsCodeApi == "function") console.log("acquireVsCodeApi is defined. This code is running inside of VS Code.");

// // Ensure it doesn't crash if previewed outside of VS Code (e.g., standard browser)
// const vscode: VSCodeApi =
//   typeof acquireVsCodeApi === "function"
//     ? acquireVsCodeApi()
//     : {
//         postMessage: (message: unknown) => {
//           console.warn("vscode.postMessage called outside of VS Code:", message);
//         },
//         getState: () => {
//           console.warn("vscode.getState called outside of VS Code");
//           return undefined;
//         },
//         setState: (state: unknown) => {
//           console.warn("vscode.setState called outside of VS Code:", state);
//         },
//       };

// export default vscode;
