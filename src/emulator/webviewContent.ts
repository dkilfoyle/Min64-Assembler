import * as vscode from "vscode";

export function getWebviewContent(distUri: vscode.Uri): string {
  // Use a strict Content Security Policy (CSP) to permit our scripts and workers
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
      default-src 'none'; 
      script-src ${distUri.scheme}?: ${distUri}; 
      style-src 'unsafe-inline';
      worker-src ${distUri.scheme}?: ${distUri};">
    <style>
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background-color: #1e1e1e;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }
      canvas {
        background-color: #000;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        image-rendering: pixelated; /* Crisp edges for low-res retro emulators */
        max-width: 100%;
        max-height: 100%;
      }
    </style>
  </head>
  <body>
    <!-- The physical viewport canvas -->
    <canvas id="emulator-canvas" width="256" height="240"></canvas>

    <!-- Configure global environment paths so main.js can safely find worker.js -->
    <script>
      window.DIST_URI = "${distUri}";
    </script>
    
    <!-- Load the main UI UI script -->
    <script src="${distUri}/main.js"></script>
  </body>
  </html>`;
}
