// Bundles the language server into one CommonJS file that the Zed extension embeds
// (include_str! in ../src/lib.rs) and writes to its work directory at runtime.
// The bundle is committed: Zed builds extensions with cargo only.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/blade-html-server.cjs',
  bundle: true,
  platform: 'node',
  // vscode-html-languageservice's UMD build ("main") hides its requires from the bundler
  mainFields: ['module', 'main'],
  format: 'cjs',
  target: 'node20',
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'eof',
  logLevel: 'info',
});
