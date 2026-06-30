## Langium/Monaco template

Simple template example for combining:

- Vite
- React
- Langium
- Monaco

Process

1. Dependencies (make sure the versions are compatible)

```bash
npm install monaco-languageclient
npm install @typefox/monaco-editor-react
npm install @codingame/esbuild-import-meta-url-plugin
npm install @codingame/monaco-vscode-lifecycle-service-override
npm install @codingame/monaco-vscode-localization-service-override
npm install langium
```

2. Edit vite.config.ts

```ts
  {optimizeDeps: {
    include: ["vscode-textmate"],
    esbuildOptions: {
      plugins: [importMetaUrlPlugin],
    },
  }}
```
