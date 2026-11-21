// Bundles the language server into one CommonJS file: dist/blade-html-server.cjs. The release
// workflow attaches it to the GitHub release `v<version>`, which the Zed extension downloads
// (../src/lib.rs). CommonJS (.cjs) runs regardless of the nearest package.json "type".
import * as fs from 'node:fs';
import { build } from 'esbuild';

const { version } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/blade-html-server.cjs',
  bundle: true,
  platform: 'node',
  // vscode-html-languageservice's UMD build ("main") hides its requires from the bundler
  mainFields: ['module', 'main'],
  format: 'cjs',
  target: 'node20',
  define: { BLADE_HTML_VERSION: JSON.stringify(version) },
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'eof',
  logLevel: 'info',
});
