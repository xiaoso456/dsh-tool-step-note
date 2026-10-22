import { defineConfig } from 'tsdown'

const PLUGIN_ID = '@xiaoso/dsh-tool-step-note'

/** Externals the browser module loader answers from its frozen table. */
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    // Node half: the assembly transform and the tool-list route.
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
  {
    // Browser half: the Settings page, emitted as the closure factory the
    // web module loader expects.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    clean: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
