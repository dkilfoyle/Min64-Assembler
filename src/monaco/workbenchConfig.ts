/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import { LogLevel } from "@codingame/monaco-vscode-api";
import getEnvironmentServiceOverride from "@codingame/monaco-vscode-environment-service-override";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
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
import getDebugServiceOverride from "@codingame/monaco-vscode-debug-service-override";
import getOutputServiceOverride from "@codingame/monaco-vscode-output-service-override";
import * as vscode from "vscode";

import "@codingame/monaco-vscode-search-result-default-extension";

import { createDefaultLocaleConfiguration } from "monaco-languageclient/vscodeApiLocales";
import { MonacoVscodeApiWrapper, type MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";

import type { RegisterLocalProcessExtensionResult } from "@codingame/monaco-vscode-api/extensions";
import { minasmExtensionConfig } from "../minasm/config/extensionConfig";
import { minminExtensionConfig } from "../minmin/config/extensionConfig";
import { createFileSystem, workspaceFileUri } from "./filesystem";

export type ConfigResult = {
  vscodeApiConfig: MonacoVscodeApiConfig;
  workspaceFileUri: vscode.Uri;
};

export const configure = async (htmlContainer?: HTMLElement): Promise<ConfigResult> => {
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
      ...getDebugServiceOverride(),
      ...getOutputServiceOverride(),
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
        "window.restoreWindows": "none",
        "files.hotExit": "off",
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

  createFileSystem();

  return {
    vscodeApiConfig,
    workspaceFileUri,
  };
};

export const configurePostStart = async (apiWrapper: MonacoVscodeApiWrapper, configResult: ConfigResult) => {
  const result = apiWrapper.getExtensionRegisterResult("min-ide") as RegisterLocalProcessExtensionResult;
  await result.setAsDefaultApi();

  // await Promise.all([
  //   vscode.workspace.openTextDocument(vscode.Uri.file("/Min64/asm/test.asm")),
  //   vscode.workspace.openTextDocument(configResult.stdminUri),
  // ]);

  // await Promise.all([
  //   vscode.window.showTextDocument(vscode.Uri.file("/Min64/asm/test.asm"), { viewColumn: vscode.ViewColumn.Active }),
  //   vscode.window.showTextDocument(configResult.stdminUri, { viewColumn: vscode.ViewColumn.Active }),
  // ]);
};
