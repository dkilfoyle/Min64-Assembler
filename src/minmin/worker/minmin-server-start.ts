/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/// <reference lib="WebWorker" />

import { URI } from "langium";
import { startLanguageServer } from "langium/lsp";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from "vscode-languageserver/browser";
import { createMinminServices } from "../ls/minmin-module.js";
import { MinminBrowserFileSystemProvider } from "../ls/minmin-filesystem.js";
import { isProgram, Program } from "../ls/generated/ast.js";
import { minCompiler } from "../compiler/v3/compiler.js";
import { MinCompileRequest } from "./api.js";
import { resolveImportUri } from "../ls/minmin-import-utils.js";

// export interface MinDocChangeNotification {
//   uri: string;
//   asm: string;
//   ast: Program;
// }

let messageReader: BrowserMessageReader | undefined;
let messageWriter: BrowserMessageWriter | undefined;

const buildTimers = new Map<string, number>();
const DEBOUNCE_DELAY_MS = 1000; // Adjust as needed

export const start = async (
  port: MessagePort | DedicatedWorkerGlobalScope,
  name: string,
) => {
  console.log(`Starting ${name}...`);
  /* browser specific setup code */
  messageReader = new BrowserMessageReader(port);
  messageWriter = new BrowserMessageWriter(port);

  messageReader.listen((message) => {
    // console.log("Received message from main thread:", message);
  });

  const connection = createConnection(messageReader, messageWriter);

  // Inject the shared services and language-specific services
  const { shared } = await createMinminServices({
    connection,
    fileSystemProvider: () => new MinminBrowserFileSystemProvider(connection),
  });

  // Start the language server with the shared services
  startLanguageServer(shared);

  connection.onRequest(MinCompileRequest, async (params) => {
    const doc = shared.workspace.LangiumDocuments.getDocument(
      URI.parse(params.uri),
    );

    if (
      doc &&
      isProgram(doc.parseResult.value) &&
      doc.diagnostics?.length == 0
    ) {
      const libs = doc.parseResult.value.elements
        .filter((e) => e.$type === "Use")
        .map((e) => e.libPath);
      const libPrograms: Program[] = libs
        .map((libPath) => {
          const importedDoc = shared.workspace.LangiumDocuments.getDocument(
            resolveImportUri(doc.uri, libPath),
          );
          return importedDoc && isProgram(importedDoc.parseResult.value)
            ? importedDoc.parseResult.value
            : null;
        })
        .filter((p): p is Program => p !== null);
      const asm = minCompiler.compile(
        params.uri,
        doc.parseResult.value,
        libPrograms,
      );
      return { uri: params.uri, asm, status: "ok", errors: [] };
    } else {
      return {
        uri: params.uri,
        asm: "",
        status: "error",
        errors: ["Document not found or has errors"],
      };
    }
  });
};

//   connection.onNotification("app/minmin-compile", async (data: MinCompileRequestNotification) => {
//     const doc = shared.workspace.LangiumDocuments.getDocument(URI.parse(data.uri));
//     if (doc) buildDoc(doc);
//   });

//   const buildDoc = (doc: LangiumDocument) => {
//     if (isProgram(doc.parseResult.value)) {
//       // console.log(`${doc.uri.toString()} AST`, doc.parseResult.value.elements);
//       if (doc.diagnostics?.length == 0) {
//         const asm = minCompiler.generate(doc.uri.toString(), doc.parseResult.value);
//         const docChangeNotification = new NotificationType<MinDocChangeNotification>("minminlsp/docChange");
//         connection.sendNotification(docChangeNotification, {
//           uri: doc.uri.toString(),
//           asm,
//           ast: doc.parseResult.value,
//         });
//       }
//     }
//   };

//   shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Validated, (documents, cancelToken) => {
//     for (const doc of documents) {
//       const uri = doc.uri.toString();

//       // 1. Clear the previous timer if the document is being built again
//       const existingTimer = buildTimers.get(uri);
//       if (existingTimer) {
//         clearTimeout(existingTimer);
//       }

//       // 2. Set up a new timer to delay the build processing
//       const timer = setTimeout(() => {
//         buildTimers.delete(uri);
//         if (cancelToken.isCancellationRequested) return;

//         // Execute your actual build/generation logic here
//         buildDoc(doc);
//       }, DEBOUNCE_DELAY_MS);

//       buildTimers.set(uri, timer);
//     }
//   });
// };
