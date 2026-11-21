import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import type { CompletionItem, Hover } from 'vscode-html-languageservice';
import { URI } from 'vscode-uri';
import { Project } from '../src/project.ts';
import { BladeHtmlService, stripImages } from '../src/service.ts';
import { createProject, type FixtureProject, lineOf, USER_CARD_VUE, withCursor } from './helpers.ts';

let fixture: FixtureProject;
let project: Project;
let service: BladeHtmlService;

before(() => {
  fixture = createProject();
  project = new Project(fixture.root, {});
  service = new BladeHtmlService();
});
after(() => fixture.cleanup());

const complete = (source: string) => {
  const { document, position } = withCursor(source, path.join(fixture.root, 'resources/views/page.blade.php'));
  return service.complete(document, position, project);
};
const labels = (source: string) => complete(source)?.items.map((i) => i.label) ?? null;
const item = (source: string, label: string): CompletionItem | undefined =>
  complete(source)?.items.find((i) => i.label === label);
const hover = (source: string) => {
  const { document, position } = withCursor(source);
  return service.hover(document, position, project);
};
const hoverText = (h: Hover | null) =>
  h && typeof h.contents === 'object' && 'value' in h.contents ? h.contents.value : '';
const definition = (source: string) => {
  const { document, position } = withCursor(source);
  return service.definition(document, position, project);
};
const targetLine = (source: string) => {
  const links = definition(source);
  assert.ok(links?.length, `definition expected for ${source}`);
  assert.equal(links[0].targetUri, URI.file(fixture.componentPath).toString());
  return links[0].targetRange.start.line;
};

describe('completion: HTML', () => {
  test('tag names after "<", next to Blade code', () => {
    const items = labels('@if($a)\n  <¦\n@endif');
    assert.ok(items?.includes('div'));
    assert.ok(items?.includes('input'));
  });

  test('attributes of a standard element', () => {
    const items = labels('<input ¦>');
    assert.ok(items?.includes('type'));
    assert.ok(items?.includes('placeholder'));
  });

  test('attribute values', () => {
    const items = labels('<input type="¦">');
    assert.ok(items?.includes('checkbox'));
    assert.ok(items?.includes('email'));
  });

  test('after an echo in an attribute value, attributes still complete and used ones are hidden', () => {
    const items = labels('<input value="{{ old(\'x\', $job->name) }}" ¦>');
    assert.ok(items?.includes('name'));
    assert.ok(!items?.includes('value'));
  });

  test('between Blade attribute directives', () => {
    const items = labels('<input @checked($a) ¦ @disabled($b)>');
    assert.ok(items?.includes('type'));
  });

  test('inside multi-line Blade-heavy markup', () => {
    const source =
      '@extends(\'layout\')\n@section(\'content\')\n@php\n  $a = "<b>";\n@endphp\n<form method="POST">\n  @csrf\n  <select ¦></select>\n</form>\n@endsection';
    const items = labels(source);
    assert.ok(items?.includes('multiple'));
  });

  test('closing tag', () => {
    const items = labels('<section>\n  {{ $x }}\n</¦');
    assert.ok(items?.some((l) => l.includes('section')));
  });

  test('no VS Code-only commands on items', () => {
    assert.ok(complete('<input ¦>')?.items.every((i) => i.command === undefined));
  });

  test('documentation has no inline base64 badges', () => {
    const doc = item('<¦', 'input')?.documentation;
    const value = typeof doc === 'object' ? doc.value : (doc ?? '');
    assert.ok(value.length > 0);
    assert.ok(!value.includes('data:image'));
  });
});

describe('completion: nothing inside Blade / PHP code', () => {
  for (const [name, source] of [
    ['echo', '<p>{{ $us¦ }}</p>'],
    ['raw echo', '<p>{!! $us¦ !!}</p>'],
    ['comment', '{{-- <inp¦ --}}'],
    ['directive arguments', '@if($a <¦ 1)'],
    ['@php block', '@php\n  $x = "<¦";\n@endphp'],
    ['echo in attribute value', '<input value="{{ $a¦ }}">'],
  ]) {
    test(name, () => assert.equal(complete(source), null));
  }
});

describe('completion: web-types components', () => {
  test('component tags are offered with HTML tags', () => {
    const items = labels('<div><¦</div>');
    assert.ok(items?.includes('UserCard'));
    assert.ok(items?.includes('GhostWidget'));
  });

  test('props and events come first', () => {
    const items = complete('<UserCard ¦></UserCard>')?.items ?? [];
    const first = items.filter((i) => i.sortText?.startsWith('0')).map((i) => i.label);
    assert.deepEqual(first.sort(), [':show-avatar', ':user-id', '@saved', 'show-avatar', 'user-id']);
    assert.ok(
      items.some((i) => i.label === 'class' && i.sortText?.startsWith('1')),
      'global HTML attributes stay available',
    );
  });

  test('v-bind:/v-on: long forms only while typing "v-"', () => {
    assert.ok(!labels('<UserCard ¦></UserCard>')?.includes('v-bind:user-id'));
    const typing = labels('<UserCard v-¦></UserCard>');
    assert.ok(typing?.includes('v-bind:user-id'));
    assert.ok(typing?.includes('v-on:saved'));
  });

  test('a prop bound in any form is not offered again', () => {
    const items = labels('<UserCard :user-id="{{ $id }}" ¦></UserCard>');
    assert.ok(!items?.includes('user-id'));
    assert.ok(!items?.includes(':user-id'));
    assert.ok(items?.includes('show-avatar'));
  });

  test('the attribute being edited does not hide its own alternatives', () => {
    const items = labels('<UserCard :user¦></UserCard>');
    assert.ok(items?.includes(':user-id'));
  });

  test('kebab-case and lower-case usages resolve the component', () => {
    assert.ok(labels('<user-card ¦></user-card>')?.includes(':user-id'));
    assert.ok(labels('<usercard ¦></usercard>')?.includes(':user-id'));
  });

  test('boolean props insert without a value', () => {
    const edit = item('<UserCard ¦></UserCard>', 'show-avatar')?.textEdit;
    assert.ok(edit && 'newText' in edit);
    assert.equal(edit.newText, 'show-avatar');
    const bound = item('<UserCard ¦></UserCard>', ':user-id')?.textEdit;
    assert.equal(bound && 'newText' in bound ? bound.newText : '', ':user-id="$1"');
  });

  test('global web-types attributes on every element', () => {
    assert.ok(labels('<div ¦>')?.includes('x-tooltip'));
  });

  test('Vue built-ins when the project depends on vue', () => {
    assert.ok(labels('<div ¦>')?.includes('v-if'));
    assert.ok(labels('<¦')?.includes('transition'));
  });
});

describe('hover', () => {
  test('standard element', () => {
    assert.match(hoverText(hover('<inp¦ut name="a">')), /input element/i);
  });

  test('component tag shows the web-types description', () => {
    assert.match(hoverText(hover('<User¦Card></UserCard>')), /\*\*UserCard\*\* shows a user/);
    assert.match(hoverText(hover('<UserCard></User¦Card>')), /\*\*UserCard\*\* shows a user/);
  });

  test('kebab-case component tag and its props', () => {
    assert.match(hoverText(hover('<user-¦card></user-card>')), /\*\*UserCard\*\* shows a user/);
    assert.match(hoverText(hover('<user-card :user¦-id="1"></user-card>')), /`userId`/);
  });

  test('prop in every binding form', () => {
    for (const source of [
      '<UserCard user¦-id="1">',
      '<UserCard :user¦-id="1">',
      '<UserCard v-bind:user¦-id="1">',
      '<UserCard :user¦-id.camel="1">',
    ]) {
      assert.match(hoverText(hover(source)), /`userId`: `number`, required/, source);
    }
  });

  test('event', () => {
    assert.match(hoverText(hover('<UserCard @sa¦ved="x">')), /Emitted after saving/);
    assert.match(hoverText(hover('<UserCard @sa¦ved.once="x">')), /Emitted after saving/);
  });

  test('nothing inside Blade code', () => {
    assert.equal(hover('<div>{{ $in¦put }}</div>'), null);
    assert.equal(hover('@if($div¦)'), null);
  });

  test('stripImages removes data-URI images only', () => {
    assert.equal(
      stripImages('a ![Baseline icon](data:image/svg+xml;base64,AAA) b ![x](https://e/x.png)'),
      'a b ![x](https://e/x.png)',
    );
  });
});

describe('go to definition', () => {
  const componentLine = lineOf(USER_CARD_VUE, USER_CARD_VUE.indexOf("name: 'usercard'"));
  const userIdLine = lineOf(USER_CARD_VUE, USER_CARD_VUE.indexOf('userId: {'));
  const savedLine = lineOf(USER_CARD_VUE, USER_CARD_VUE.indexOf("'saved'"));

  test('component start tag (start, middle and end of the name)', () => {
    assert.equal(targetLine('<¦UserCard></UserCard>'), componentLine);
    assert.equal(targetLine('<User¦Card></UserCard>'), componentLine);
    assert.equal(targetLine('<UserCard¦></UserCard>'), componentLine);
  });

  test('component end tag', () => {
    assert.equal(targetLine('<UserCard>\n</User¦Card>'), componentLine);
  });

  test('self-closing and kebab-case usage', () => {
    assert.equal(targetLine('<User¦Card :user-id="1" />'), componentLine);
    assert.equal(targetLine('<user-¦card></user-card>'), componentLine);
  });

  test('target range covers the identifier at the source offset', () => {
    const links = definition('<User¦Card></UserCard>');
    const range = links?.[0].targetRange;
    assert.ok(range);
    assert.equal(range.end.character - range.start.character, 'name'.length);
  });

  test('origin range is the whole tag / attribute name (Ctrl+hover underline)', () => {
    const tag = definition('<Us¦erCard></UserCard>')?.[0].originSelectionRange;
    assert.deepEqual(tag, { start: { line: 0, character: 1 }, end: { line: 0, character: 9 } });
    const attribute = definition('<UserCard :user-¦id="1"></UserCard>')?.[0].originSelectionRange;
    assert.deepEqual(attribute, { start: { line: 0, character: 10 }, end: { line: 0, character: 18 } });
  });

  test('props in every binding form, with Blade values', () => {
    for (const source of [
      '<UserCard user-¦id="{{ $id }}"></UserCard>',
      '<UserCard :user-¦id="{{ vue_pass_string($job->id) }}"></UserCard>',
      '<UserCard v-bind:user¦-id="id"></UserCard>',
      '<UserCard :userI¦d="id"></UserCard>',
    ]) {
      assert.equal(targetLine(source), userIdLine, source);
    }
  });

  test('props on following lines of a multi-line tag after Blade directives', () => {
    const source =
      '@if($show)\n<UserCard\n    @class([\'a\'])\n    show-avatar\n    :user-¦id="{{ $id }}"\n></UserCard>\n@endif';
    assert.equal(targetLine(source), userIdLine);
  });

  test('events', () => {
    assert.equal(targetLine('<UserCard @sav¦ed="onSaved"></UserCard>'), savedLine);
    assert.equal(targetLine('<UserCard v-on:sav¦ed="onSaved"></UserCard>'), savedLine);
  });

  test('no definition for unknown attributes, values, HTML elements and Blade code', () => {
    assert.equal(definition('<UserCard cla¦ss="x"></UserCard>'), null);
    assert.equal(definition('<UserCard :user-id="i¦d"></UserCard>'), null);
    assert.equal(definition('<di¦v></div>'), null);
    assert.equal(definition('<UserCard :user-id="{{ $us¦er }}"></UserCard>'), null);
    assert.equal(definition('<p>¦</p>'), null);
  });

  test('component without a source in web-types', () => {
    assert.equal(definition('<Ghost¦Widget size="1"></GhostWidget>'), null);
  });

  test('missing source file', () => {
    const other = createProject();
    try {
      const otherProject = new Project(other.root, {});
      fs.rmSync(other.componentPath);
      const { document, position } = withCursor('<User¦Card></UserCard>');
      assert.equal(service.definition(document, position, otherProject), null);
    } finally {
      other.cleanup();
    }
  });
});

describe('linked editing and highlights', () => {
  test('renaming a tag edits its pair, positions intact after Blade code', () => {
    const { document, position } = withCursor('@if ($a > 1)\n{{ $b }}<se¦ction>\n  @csrf\n</section>\n@endif');
    const ranges = service.linkedEditingRanges(document, position, project);
    assert.ok(ranges);
    assert.deepEqual(
      ranges.map((r) => document.getText(r)),
      ['section', 'section'],
    );
  });

  test('no linked editing inside Blade code', () => {
    const { document, position } = withCursor('<div>{{ $a¦ }}</div>');
    assert.equal(service.linkedEditingRanges(document, position, project), null);
  });

  test('matching tag highlights', () => {
    const { document, position } = withCursor('<ul>\n  <li>{{ $x }}</li>\n</u¦l>');
    const highlights = service.documentHighlights(document, position, project);
    assert.equal(highlights.length, 2);
  });
});

describe('project data reload and settings', () => {
  let local: FixtureProject;
  const interval = Project.refreshIntervalMs;
  beforeEach(() => {
    local = createProject();
    Project.refreshIntervalMs = 0;
  });
  afterEach(() => {
    local.cleanup();
    Project.refreshIntervalMs = interval;
  });

  test('web-types changes are picked up without a restart', () => {
    const p = new Project(local.root, {});
    assert.ok(p.findComponent('UserCard'));
    const json = JSON.parse(fs.readFileSync(local.webTypesPath, 'utf8'));
    json.contributions.html.elements.push({ name: 'NewThing', attributes: [] });
    fs.writeFileSync(local.webTypesPath, JSON.stringify(json));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(local.webTypesPath, future, future);
    p.refresh();
    assert.ok(p.findComponent('NewThing'));
  });

  test('a broken web-types file keeps HTML working and is reported', () => {
    const messages: string[] = [];
    fs.writeFileSync(local.webTypesPath, '{ broken');
    const p = new Project(local.root, {}, (m) => messages.push(m));
    assert.equal(p.componentCount, 0);
    assert.ok(messages.some((m) => m.startsWith('Cannot read web-types')));
    const { document, position } = withCursor('<inp¦');
    assert.ok(service.complete(document, position, p)?.items.some((i) => i.label === 'input'));
  });

  test('vue: false disables the Vue built-ins, vue: true forces them', () => {
    const { document, position } = withCursor('<div ¦>');
    const has = (p: Project) => service.complete(document, position, p)?.items.some((i) => i.label === 'v-if');
    assert.equal(has(new Project(local.root, { vue: false })), false);
    const noVue = createProject({ vue: false });
    try {
      assert.equal(has(new Project(noVue.root, {})), false);
      assert.equal(has(new Project(noVue.root, { vue: true })), true);
    } finally {
      noVue.cleanup();
    }
  });

  test('configured webTypes paths', () => {
    fs.renameSync(local.webTypesPath, path.join(local.root, 'elsewhere.json'));
    assert.equal(new Project(local.root, {}).findComponent('UserCard'), undefined);
    assert.ok(new Project(local.root, { webTypes: ['elsewhere.json'] }).findComponent('UserCard'));
  });

  test('files outside any workspace folder get plain HTML', () => {
    const loose = new Project(undefined, {});
    assert.equal(loose.componentCount, 0);
    const { document, position } = withCursor('<inp¦');
    assert.ok(service.complete(document, position, loose)?.items.some((i) => i.label === 'input'));
  });
});
