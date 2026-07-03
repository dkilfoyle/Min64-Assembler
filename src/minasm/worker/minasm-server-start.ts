/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/// <reference lib="WebWorker" />

import { DocumentState, EmptyFileSystem } from "langium";
import { startLanguageServer } from "langium/lsp";
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";
import { createMinasmServices } from "../ls/minasm-module.js";
import { assembler } from "../assembler/assembler.js";
import { isProgram } from "../ls/generated/ast.js";

let messageReader: BrowserMessageReader | undefined;
let messageWriter: BrowserMessageWriter | undefined;

export const start = async (port: MessagePort | DedicatedWorkerGlobalScope, name: string) => {
  console.log(`Starting ${name}...`);
  /* browser specific setup code */
  messageReader = new BrowserMessageReader(port);
  messageWriter = new BrowserMessageWriter(port);

  messageReader.listen((message) => {
    // console.log("Received message from main thread:", message);
  });

  const connection = createConnection(messageReader, messageWriter);

  // Inject the shared services and language-specific services
  const { shared } = await createMinasmServices({ connection, ...EmptyFileSystem });

  // Start the language server with the shared services
  startLanguageServer(shared);

  shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Validated, (documents) => {
    for (const document of documents) {
      if (isProgram(document.parseResult.value)) {
        console.log("On build phase", document.parseResult.value.entries);
        assembler.assemble(document.parseResult.value);
        console.log(assembler.hex.toString());
        console.log(Array.from(assembler.labels.entries()).map(([k, v]) => `${k} -> ${v.toString(16)}`));
      }
    }
  });
};
