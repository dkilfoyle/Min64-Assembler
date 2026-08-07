/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/// <reference lib="WebWorker" />

import { DocumentState, EmptyFileSystem, URI, type AstNode, type LangiumDocument } from "langium";
import { startLanguageServer } from "langium/lsp";
import { BrowserMessageReader, BrowserMessageWriter, createConnection, NotificationType } from "vscode-languageserver/browser";
import { createMinasmServices } from "../ls/minasm-module.js";
import { assembler } from "../assembler/assembler.js";
import { isProgram } from "../ls/generated/ast.js";
import { AsmCompileRequest } from "./api.js";

let messageReader: BrowserMessageReader | undefined;
let messageWriter: BrowserMessageWriter | undefined;

const buildTimers = new Map<string, number>();
const DEBOUNCE_DELAY_MS = 500; // Adjust as needed

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

  connection.onRequest(AsmCompileRequest, async (params) => {
    const doc = shared.workspace.LangiumDocuments.getDocument(URI.parse(params.uri));
    if (doc && isProgram(doc.parseResult.value) && doc.diagnostics?.length == 0) {
      assembler.assemble(doc.parseResult.value);
      // console.log("Locations:", assembler.locations);
      return { uri: params.uri, hex: assembler.hex.toString(), locations: assembler.locations, labels: assembler.labels };
    } else {
      console.error("Document not found for URI:", params.uri);
      throw Error();
    }
  });

  // shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Validated, (documents, cancelToken) => {
  //   for (const doc of documents) {
  //     const uri = doc.uri.toString();

  //     // 1. Clear the previous timer if the document is being built again
  //     const existingTimer = buildTimers.get(uri);
  //     if (existingTimer) {
  //       clearTimeout(existingTimer);
  //     }

  //     // 2. Set up a new timer to delay the build processing
  //     const timer = setTimeout(() => {
  //       buildTimers.delete(uri);
  //       if (cancelToken.isCancellationRequested) return;

  //       // Execute your actual build/generation logic here
  //       buildDoc(doc);
  //     }, DEBOUNCE_DELAY_MS);

  //     buildTimers.set(uri, timer);
  //   }
  // });
};
