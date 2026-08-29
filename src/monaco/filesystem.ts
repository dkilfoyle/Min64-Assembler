import {
  InMemoryFileSystemProvider,
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
  type IFileWriteOptions,
} from "@codingame/monaco-vscode-files-service-override";
import * as vscode from "vscode";
import { DslLibraryFileSystemProvider } from "./DslFileSystemProvider";

export const workspaceFileUri = vscode.Uri.file("/workspace.code-workspace");

export const createFileSystem = async () => {
  // const stdminUri = vscode.Uri.file("/min/std.min");

  // const fileSystemProvider = new InMemoryFileSystemProvider();
  const fileSystemProvider = new RegisteredFileSystemProvider(false);
  const textEncoder = new TextEncoder();

  const options: IFileWriteOptions = {
    atomic: false,
    unlock: false,
    create: true,
    overwrite: true,
  };

  // await fileSystemProvider.mkdir(vscode.Uri.file("/Min64"));
  // await fileSystemProvider.mkdir(vscode.Uri.file("/Min64/asm"));
  // await fileSystemProvider.mkdir(vscode.Uri.file("/Min64/min"));

  // await fileSystemProvider.writeFile(
  //   workspaceFileUri,
  //   textEncoder.encode(createDefaultWorkspaceContent("/Min64")),
  //   options,
  // );
  await fileSystemProvider.registerFile(
    new RegisteredMemoryFile(
      workspaceFileUri,
      textEncoder.encode(createDefaultWorkspaceContent("/Min64")),
    ),
  );

  // const examplesAsm = import.meta.glob<string>("../minasm/examples/*.asm", {
  //   eager: true,
  //   query: "?raw",
  //   import: "default",
  // });
  // Object.entries(examplesAsm).forEach(async ([key, value]) => {
  //   await fileSystemProvider.writeFile(
  //     vscode.Uri.file(`/Min64/asm/${key.replace("../minasm/examples/", "")}`),
  //     textEncoder.encode(value),
  //     options,
  //   );
  // });

  const examplesMin = import.meta.glob<string>("../minmin/examples/*.min", {
    eager: true,
    query: "?raw",
    import: "default",
  });
  Object.entries(examplesMin).forEach(([key, value]) => {
    // fileSystemProvider.writeFile(
    //   vscode.Uri.file(`/Min64/min/${key.replace("../minmin/examples/", "")}`),
    //   textEncoder.encode(value),
    //   options,
    // );
    fileSystemProvider.registerFile(
      new RegisteredMemoryFile(
        vscode.Uri.file(`/Min64/min/${key.replace("../minmin/examples/", "")}`),
        textEncoder.encode(value),
      ),
    );
  });

  registerFileSystemOverlay(1, fileSystemProvider);
};

const createDefaultWorkspaceContent = (workspacePath: string) => {
  return JSON.stringify(
    {
      folders: [
        {
          path: workspacePath,
        },
      ],
    },
    null,
    2,
  );
};
