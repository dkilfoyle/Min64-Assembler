import type { FileSystemNode, FileSystemProvider } from "langium";
import type { Connection } from "vscode-languageserver";
import type { URI } from "vscode-uri";
import { MinReadFileRequest } from "../worker/api.js";

const notSupported = (): never => {
  throw new Error("Not supported in the browser worker file system.");
};

// JSON-RPC "MethodNotFound": the main thread hasn't registered its read handler yet
// (e.g. while the workbench is still restoring previously-open editors on page load).
const METHOD_NOT_FOUND = -32601;
const MAX_READ_RETRIES = 15;
const READ_RETRY_DELAY_MS = 200;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bridges Langium's file access to the main thread's virtual filesystem (Monaco's
 * RegisteredFileSystemProvider), since the language server runs in a Web Worker
 * with no direct file system access of its own.
 */
export class MinminBrowserFileSystemProvider implements FileSystemProvider {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async readFile(uri: URI): Promise<string> {
    const uriString = uri.toString();
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.connection.sendRequest(MinReadFileRequest, {
          uri: uriString,
        });
        return result.content;
      } catch (error) {
        const code = (error as { code?: number } | undefined)?.code;
        if (code !== METHOD_NOT_FOUND || attempt >= MAX_READ_RETRIES) throw error;
        await delay(READ_RETRY_DELAY_MS);
      }
    }
  }

  async exists(uri: URI): Promise<boolean> {
    try {
      await this.readFile(uri);
      return true;
    } catch {
      return false;
    }
  }

  readFileSync = notSupported;
  existsSync = (): boolean => false;
  stat = notSupported;
  statSync = notSupported;
  readBinary = notSupported;
  readBinarySync = notSupported;
  readDirectory = async (): Promise<FileSystemNode[]> => [];
  readDirectorySync = (): FileSystemNode[] => [];
}
