/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import { LogLevel } from "@codingame/monaco-vscode-api";
import getEnvironmentServiceOverride from "@codingame/monaco-vscode-environment-service-override";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import { InMemoryFileSystemProvider, registerFileSystemOverlay, type IFileWriteOptions } from "@codingame/monaco-vscode-files-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getLifecycleServiceOverride from "@codingame/monaco-vscode-lifecycle-service-override";
import getLocalizationServiceOverride from "@codingame/monaco-vscode-localization-service-override";
import getOutlineServiceOverride from "@codingame/monaco-vscode-outline-service-override";
import getRemoteAgentServiceOverride from "@codingame/monaco-vscode-remote-agent-service-override";
import getSearchServiceOverride from "@codingame/monaco-vscode-search-service-override";
import getSecretStorageServiceOverride from "@codingame/monaco-vscode-secret-storage-service-override";
import getStorageServiceOverride from "@codingame/monaco-vscode-storage-service-override";
import getBannerServiceOverride from "@codingame/monaco-vscode-view-banner-service-override";
import getStatusBarServiceOverride from "@codingame/monaco-vscode-view-status-bar-service-override";
import getTitleBarServiceOverride from "@codingame/monaco-vscode-view-title-bar-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import getMarkersServiceOverride from "@codingame/monaco-vscode-markers-service-override";
import * as vscode from "vscode";

import "@codingame/monaco-vscode-search-result-default-extension";

import { createDefaultLocaleConfiguration } from "monaco-languageclient/vscodeApiLocales";
import { MonacoVscodeApiWrapper, type MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";

import blocksMinCode from "../minmin/examples/blocks.min?raw";
import stdMinCode from "../minmin/examples/std.min?raw";
import testminCode from "../minmin/examples/test.min?raw";
import type { RegisterLocalProcessExtensionResult } from "@codingame/monaco-vscode-api/extensions";
import { minasmExtensionConfig } from "../minasm/config/extensionConfig";
import { minminExtensionConfig } from "../minmin/config/extensionConfig";

export type ConfigResult = {
  vscodeApiConfig: MonacoVscodeApiConfig;
  workspaceFileUri: vscode.Uri;
  stdminUri: vscode.Uri;
  blocksminUri: vscode.Uri;
  testminUri: vscode.Uri;
};

export const configure = async (htmlContainer?: HTMLElement): Promise<ConfigResult> => {
  const workspaceFileUri = vscode.Uri.file("/workspace.code-workspace");

  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: "extended",
    logLevel: LogLevel.Info,
    serviceOverrides: {
      ...getKeybindingsServiceOverride(),
      ...getLifecycleServiceOverride(),
      ...getLocalizationServiceOverride(createDefaultLocaleConfiguration()),
      ...getBannerServiceOverride(),
      ...getStatusBarServiceOverride(),
      ...getTitleBarServiceOverride(),
      ...getExplorerServiceOverride(),
      ...getRemoteAgentServiceOverride(),
      ...getEnvironmentServiceOverride(),
      ...getSecretStorageServiceOverride(),
      ...getStorageServiceOverride(),
      ...getSearchServiceOverride(),
      ...getOutlineServiceOverride(),
      ...getWorkbenchServiceOverride(),
      ...getMarkersServiceOverride(),
    },
    viewsConfig: {
      $type: "WorkbenchService",
      htmlContainer,
      // $type: "ViewsService",
      // htmlAugmentationInstructions: defaultHtmlAugmentationInstructions,
      // viewsInitFunc: defaultViewsInit,
    },
    workspaceConfig: {
      enableWorkspaceTrust: true,
      windowIndicator: {
        label: "min-ide",
        tooltip: "",
        command: "",
      },
      workspaceProvider: {
        trusted: true,
        async open() {
          window.open(window.location.href);
          return true;
        },
        workspace: {
          workspaceUri: workspaceFileUri,
        },
      },
      configurationDefaults: {
        "window.title": "min-ide${separator}${dirty}${activeEditorShort}",
      },
      productConfiguration: {
        nameShort: "min-ide",
        nameLong: "min-ide",
      },
    },
    userConfiguration: {
      json: JSON.stringify({
        "workbench.colorTheme": "Default Dark Modern",
        "editor.wordBasedSuggestions": "off",
        "editor.guides.bracketPairsHorizontal": true,
        "editor.experimental.asyncTokenization": true,
      }),
    },
    extensions: [
      {
        config: {
          name: "min-ide",
          publisher: "DK",
          version: "1.0.0",
          engines: {
            vscode: "*",
          },
        },
      },
      minasmExtensionConfig,
      minminExtensionConfig,
    ],
    advanced: {
      enableExtHostWorker: true,
    },
    monacoWorkerFactory: configureDefaultWorkerFactory,
  };

  const workspaceUri = vscode.Uri.file("/min");
  const stdminUri = vscode.Uri.file("/min/std.min");
  const blocksminUri = vscode.Uri.file("/min/blocks.min");
  const testminUri = vscode.Uri.file("/min/test.min");
  const fileSystemProvider = new InMemoryFileSystemProvider();
  const textEncoder = new TextEncoder();

  const options: IFileWriteOptions = {
    atomic: false,
    unlock: false,
    create: true,
    overwrite: true,
  };
  await fileSystemProvider.mkdir(workspaceUri);
  await fileSystemProvider.mkdir(vscode.Uri.file("/asm"));
  await fileSystemProvider.writeFile(stdminUri, textEncoder.encode(stdMinCode), options);
  await fileSystemProvider.writeFile(blocksminUri, textEncoder.encode(blocksMinCode), options);
  await fileSystemProvider.writeFile(testminUri, textEncoder.encode(testminCode), options);
  await fileSystemProvider.writeFile(workspaceFileUri, textEncoder.encode(createDefaultWorkspaceContent("/min")), options);
  registerFileSystemOverlay(1, fileSystemProvider);

  return {
    vscodeApiConfig,
    workspaceFileUri,
    stdminUri,
    blocksminUri,
    testminUri,
  };
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

export const configurePostStart = async (apiWrapper: MonacoVscodeApiWrapper, configResult: ConfigResult) => {
  const result = apiWrapper.getExtensionRegisterResult("min-ide") as RegisterLocalProcessExtensionResult;
  await result.setAsDefaultApi();

  await Promise.all([vscode.workspace.openTextDocument(configResult.testminUri), vscode.workspace.openTextDocument(configResult.stdminUri)]);

  await Promise.all([vscode.window.showTextDocument(configResult.testminUri)]);
};
