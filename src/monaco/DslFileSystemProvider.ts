import * as vscode from "vscode";

const asmBuiltins = import.meta.glob<string>("../minasm/builtin/*.asm", { eager: true, query: "?raw", import: "default" });
const minBuiltins = import.meta.glob<string>("../minmin/builtin/*.min", { eager: true, query: "?raw", import: "default" });

const lib: Record<string, Uint8Array> = Object.entries({ ...asmBuiltins, ...minBuiltins }).reduce<Record<string, Uint8Array>>(
  (acc, [key, value]) => {
    acc[`builtin:/${key.replace("../minasm/builtin/", "").replace("../minmin/builtin/", "")}`] = new TextEncoder().encode(value);
    return acc;
  },
  {},
);

console.log(lib);

export class DslLibraryFileSystemProvider implements vscode.FileSystemProvider {
  stat(uri: vscode.Uri): vscode.FileStat {
    const date = Date.now();
    return {
      ctime: date,
      mtime: date,
      size: lib[uri.toString()].length,
      type: vscode.FileType.File,
    };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    // We could return different libraries based on the URI
    // We have only one, so we always return the same
    return lib[uri.toString()];
  }

  // The following class members only serve to satisfy the interface

  private readonly didChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  onDidChangeFile = this.didChangeFile.event;

  watch() {
    return {
      dispose: () => {},
    };
  }

  readDirectory(): [] {
    throw vscode.FileSystemError.NoPermissions();
  }

  createDirectory() {
    throw vscode.FileSystemError.NoPermissions();
  }

  writeFile() {
    throw vscode.FileSystemError.NoPermissions();
  }

  delete() {
    throw vscode.FileSystemError.NoPermissions();
  }

  rename() {
    throw vscode.FileSystemError.NoPermissions();
  }
}
