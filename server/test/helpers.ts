/**
 * Test fixtures: a throw-away project (package.json + web-types.json + a Vue component) whose
 * web-types `source.offset`s are computed from the component text, and a `¦` cursor helper
 * (`|` would clash with PHP's `||`).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

export const USER_CARD_VUE = `<template>
    <div class="user-card">{{ userId }}</div>
</template>

<script>
export default {
    name: 'usercard',
    props: {
        userId: { type: Number, required: true },
        showAvatar: { type: Boolean, default: false },
    },
    emits: ['saved'],
};
</script>
`;

export const COMPONENT_FILE = 'resources/js/components/UserCard.vue';

export interface FixtureProject {
  root: string;
  componentPath: string;
  webTypesPath: string;
  /** Offsets of the definition targets in USER_CARD_VUE. */
  offsets: { component: number; userId: number; showAvatar: number; saved: number };
  write(relative: string, content: string): string;
  cleanup(): void;
}

export interface FixtureOptions {
  /** `web-types` field of package.json; null omits it (fallback: <root>/web-types.json). */
  webTypesField?: string | string[] | null;
  /** Add vue to package.json dependencies (default true). */
  vue?: boolean;
}

export function createProject(options: FixtureOptions = {}): FixtureProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blade-html-test-'));
  const write = (relative: string, content: string): string => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  const offsets = {
    component: USER_CARD_VUE.indexOf("name: 'usercard'"),
    userId: USER_CARD_VUE.indexOf('userId: {'),
    showAvatar: USER_CARD_VUE.indexOf('showAvatar: {'),
    saved: USER_CARD_VUE.indexOf("'saved'"),
  };
  const componentPath = write(COMPONENT_FILE, USER_CARD_VUE);
  const src = (offset: number) => ({ file: COMPONENT_FILE, offset });
  const prop = (name: string, offset: number, description: string, type: string) => [
    { name, description, source: src(offset), value: { kind: 'plain', type } },
    { name: `:${name}`, description, source: src(offset), value: { kind: 'expression', type } },
    { name: `v-bind:${name}`, description, source: src(offset), value: { kind: 'expression', type } },
  ];
  const webTypes = {
    $schema: 'https://raw.githubusercontent.com/JetBrains/web-types/master/schema/web-types.json',
    name: 'fixture',
    version: '1.0.0',
    'description-markup': 'markdown',
    contributions: {
      html: {
        elements: [
          {
            name: 'UserCard',
            description: '**UserCard** shows a user.',
            source: src(offsets.component),
            attributes: [
              ...prop('user-id', offsets.userId, '`userId`: `number`, required', 'number'),
              ...prop('show-avatar', offsets.showAvatar, '`showAvatar`: `boolean`, default `false`', 'boolean'),
              { name: '@saved', description: 'Emitted after saving', source: src(offsets.saved) },
              { name: 'v-on:saved', description: 'Emitted after saving', source: src(offsets.saved) },
            ],
          },
          // No source: completion/hover only, no definition
          { name: 'GhostWidget', description: 'Has no source', attributes: [{ name: 'size' }] },
        ],
        attributes: [{ name: 'x-tooltip', description: 'Global tooltip directive' }],
      },
    },
  };
  const webTypesPath = write('web-types.json', JSON.stringify(webTypes, null, 2));

  const pkg: Record<string, unknown> = { name: 'fixture', private: true };
  const field = options.webTypesField === undefined ? './web-types.json' : options.webTypesField;
  if (field !== null) {
    pkg['web-types'] = field;
  }
  if (options.vue !== false) {
    pkg.dependencies = { vue: '^3.5.0' };
  }
  write('package.json', JSON.stringify(pkg, null, 2));

  return {
    root,
    componentPath,
    webTypesPath,
    offsets,
    write,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export const CURSOR = '¦';

/** A Blade document from text with one `¦` cursor marker; returns the document and offset. */
export function withCursor(textWithCursor: string, file = '/tmp/view.blade.php') {
  const offset = textWithCursor.indexOf(CURSOR);
  if (offset < 0 || textWithCursor.indexOf(CURSOR, offset + 1) >= 0) {
    throw new Error(`expected exactly one ${CURSOR} cursor marker`);
  }
  const text = textWithCursor.slice(0, offset) + textWithCursor.slice(offset + 1);
  const document = TextDocument.create(URI.file(file).toString(), 'blade', 1, text);
  return { document, text, offset, position: document.positionAt(offset) };
}

/** Line (0-based) of `offset` in `text`. */
export function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length - 1;
}
