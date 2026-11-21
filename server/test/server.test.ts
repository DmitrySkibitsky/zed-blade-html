/**
 * End-to-end: the bundled server (dist/blade-html-server.cjs — the file the Zed extension embeds)
 * over stdio, with a generated project. Run `npm run build` first (`npm test` does).
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { URI } from 'vscode-uri';
import { createProject, type FixtureProject } from './helpers.ts';
import { LspClient } from './lspClient.ts';

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/blade-html-server.cjs');

const VIEW = `@extends('layouts.app')
@section('content')
    @php
        /** @var \\App\\Models\\Job $job */
    @endphp
    <form method="POST" action="{{ route('job.store') }}">
        @csrf
        @if (config('x.enabled') === 1 && $job->id)
            <div class="row">
                <UserCard
                    :user-id="{{ $job->user_id }}"
                    @saved="onSaved"
                ></UserCard>
            </div>
        @endif
        <input type="text" name="title" value="{{ old('title') }}" >
    </form>
@endsection
`;

describe('bundled server over stdio', () => {
  let fixture: FixtureProject;
  let client: LspClient;
  let uri: string;
  let capabilities: Record<string, any>;
  const at = (needle: string, delta = 0) => {
    const offset = VIEW.indexOf(needle) + delta;
    const before = VIEW.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before[before.length - 1].length };
  };

  before(async () => {
    assert.ok(fs.existsSync(BUNDLE), `missing ${BUNDLE}: run npm run build`);
    fixture = createProject();
    const viewPath = fixture.write('resources/views/jobs/form.blade.php', VIEW);
    uri = URI.file(viewPath).toString();
    client = new LspClient(process.execPath, [BUNDLE, '--stdio']);
    const result = await client.request('initialize', {
      processId: process.pid,
      rootUri: URI.file(fixture.root).toString(),
      workspaceFolders: [{ uri: URI.file(fixture.root).toString(), name: 'fixture' }],
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown'] } },
          hover: { contentFormat: ['markdown'] },
        },
      },
      initializationOptions: null,
    });
    assert.equal(result.serverInfo.name, 'blade-html');
    const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(BUNDLE), '../package.json'), 'utf8'));
    assert.equal(result.serverInfo.version, pkg.version, 'bundle reports the package version');
    capabilities = result.capabilities;
    client.notify('initialized', {});
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'blade', version: 1, text: VIEW } });
  });

  after(async () => {
    try {
      assert.equal(await client.shutdown(), 0);
    } finally {
      client.kill();
      fixture.cleanup();
    }
  });

  test('advertises the implemented capabilities', () => {
    assert.equal(capabilities.textDocumentSync, 2, 'incremental sync');
    assert.ok(capabilities.completionProvider.triggerCharacters.includes('<'));
    assert.equal(capabilities.hoverProvider, true);
    assert.equal(capabilities.definitionProvider, true);
    assert.equal(capabilities.linkedEditingRangeProvider, true);
    assert.equal(capabilities.documentHighlightProvider, true);
    assert.equal(capabilities.documentFormattingProvider, undefined, 'formatting is left to the Blade formatter');
  });

  test('hover on a standard element and matching tag highlights', async () => {
    const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: at('<div', 2) });
    assert.match(hover.contents.value, /div/i);
    const highlights = await client.request('textDocument/documentHighlight', {
      textDocument: { uri },
      position: at('<form', 2),
    });
    assert.equal(highlights.length, 2);
  });

  test('completion of component props inside a multi-line tag', async () => {
    const list = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: at('@saved="onSaved"', '@saved="onSaved"'.length + 1),
    });
    const labels: string[] = list.items.map((i: { label: string }) => i.label);
    assert.ok(labels.includes('show-avatar'));
    assert.ok(!labels.includes(':user-id'), 'bound prop is not offered again');
    assert.ok(!labels.includes('@saved'), 'bound event is not offered again');
  });

  test('completion of HTML attributes after Blade echoes', async () => {
    const list = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: at('value="{{ old(\'title\') }}" ', 'value="{{ old(\'title\') }}" '.length),
    });
    const labels: string[] = list.items.map((i: { label: string }) => i.label);
    assert.ok(labels.includes('placeholder'));
    assert.ok(!labels.includes('name'));
  });

  test('no completion inside PHP code', async () => {
    const result = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: at('$job->id', 6),
    });
    assert.equal(result, null);
  });

  test('go to definition of the component and its prop', async () => {
    const tag = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: at('<UserCard', 3),
    });
    assert.equal(tag[0].targetUri, URI.file(fixture.componentPath).toString());
    const prop = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: at(':user-id', 3),
    });
    assert.equal(prop[0].targetUri, URI.file(fixture.componentPath).toString());
    assert.notDeepEqual(prop[0].targetRange, tag[0].targetRange);
  });

  test('hover on a component', async () => {
    const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: at('<UserCard', 2) });
    assert.match(hover.contents.value, /UserCard/);
  });

  test('linked editing of a tag pair', async () => {
    const result = await client.request('textDocument/linkedEditingRange', {
      textDocument: { uri },
      position: at('<form', 2),
    });
    assert.equal(result.ranges.length, 2);
  });

  test('incremental edits are applied', async () => {
    const position = at('<input', 0);
    client.notify('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ range: { start: position, end: position }, text: '<select ></select>\n        ' }],
    });
    const list = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: { line: position.line, character: position.character + 8 },
    });
    assert.ok(list.items.some((i: { label: string }) => i.label === 'multiple'));
  });

  test('configuration changes reload project data', async () => {
    client.notify('workspace/didChangeConfiguration', { settings: { webTypes: ['nothing-here.json'], vue: false } });
    const list = await client.request('textDocument/completion', { textDocument: { uri }, position: at('<div', 1) });
    const labels: string[] = list.items.map((i: { label: string }) => i.label);
    assert.ok(!labels.includes('UserCard'));
    assert.ok(labels.includes('div'));
    client.notify('workspace/didChangeConfiguration', { settings: {} });
    const restored = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: at('<div', 1),
    });
    assert.ok(restored.items.some((i: { label: string }) => i.label === 'UserCard'));
  });

  test('nothing failed on the server side', () => {
    const errors = client.notifications.filter(
      (n) => n.method === 'window/logMessage' && (n.params.type === 1 || /failed|error/i.test(n.params.message)),
    );
    assert.deepEqual(errors, []);
    assert.ok(
      client.notifications.some(
        (n) => n.method === 'window/logMessage' && /Loaded 2 components/.test(n.params.message),
      ),
      'web-types load is logged',
    );
  });

  test('unknown documents are answered gracefully', async () => {
    const result = await client.request('textDocument/hover', {
      textDocument: { uri: 'file:///nope.blade.php' },
      position: { line: 0, character: 0 },
    });
    assert.equal(result, null);
  });
});
