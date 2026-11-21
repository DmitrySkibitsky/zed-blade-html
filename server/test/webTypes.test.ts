import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { parseSettings } from '../src/project.ts';
import { attributeKey, componentKey, discoverWebTypes, parseWebTypes, toKebabCase, usesVue } from '../src/webTypes.ts';
import { COMPONENT_FILE, createProject } from './helpers.ts';

describe('name normalisation', () => {
  test('componentKey: Pascal, kebab and lower case meet (Vue in-DOM templates)', () => {
    const key = componentKey('AudioRecordOneFile');
    assert.equal(componentKey('audio-record-one-file'), key);
    assert.equal(componentKey('audiorecordonefile'), key);
    assert.equal(componentKey('AUDIORECORDONEFILE'), key);
    assert.notEqual(componentKey('AudioRecord'), key);
  });

  test('attributeKey: every binding form of a prop maps to one key', () => {
    const key = attributeKey('getUrl');
    for (const form of ['get-url', ':get-url', 'v-bind:get-url', ':getUrl', ':get-url.camel', 'v-bind:get-url.prop']) {
      assert.equal(attributeKey(form), key, form);
    }
  });

  test('attributeKey: events are separate from props', () => {
    const event = attributeKey('@on-file-loaded');
    assert.equal(attributeKey('v-on:on-file-loaded'), event);
    assert.equal(attributeKey('@onFileLoaded'), event);
    assert.equal(attributeKey('@on-file-loaded.once'), event);
    assert.notEqual(attributeKey('on-file-loaded'), event);
  });

  test('attributeKey: slots and arguments', () => {
    assert.equal(attributeKey('#header'), attributeKey('v-slot:header'));
    assert.notEqual(attributeKey('#header'), attributeKey('header'));
    assert.equal(attributeKey('@update:model-value'), attributeKey('v-on:update:modelValue'));
  });

  test('toKebabCase', () => {
    assert.equal(toKebabCase('getUrl'), 'get-url');
    assert.equal(toKebabCase('isCarpentersDispatch'), 'is-carpenters-dispatch');
    assert.equal(toKebabCase('HTMLContent'), 'html-content');
    assert.equal(toKebabCase('size'), 'size');
  });
});

describe('parseWebTypes', () => {
  const fixture = createProject();
  after(() => fixture.cleanup());

  test('elements become tags with markdown descriptions and references', () => {
    const data = parseWebTypes(fixture.webTypesPath);
    const tag = data.tags.find((t) => t.name === 'UserCard');
    assert.ok(tag);
    assert.deepEqual(tag.description, { kind: 'markdown', value: '**UserCard** shows a user.' });
    assert.ok(tag.references?.some((r) => r.url.endsWith('/UserCard.vue')));
    assert.deepEqual(
      tag.attributes.map((a) => a.name),
      [
        'user-id',
        ':user-id',
        'v-bind:user-id',
        'show-avatar',
        ':show-avatar',
        'v-bind:show-avatar',
        '@saved',
        'v-on:saved',
      ],
    );
  });

  test('source files resolve relative to the web-types file', () => {
    const data = parseWebTypes(fixture.webTypesPath);
    const component = data.components.find((c) => c.name === 'UserCard');
    assert.equal(component?.source?.file, path.join(fixture.root, COMPONENT_FILE));
    assert.equal(component?.source?.offset, fixture.offsets.component);
    assert.equal(component?.attributes.find((a) => a.name === ':user-id')?.source?.offset, fixture.offsets.userId);
  });

  test('plain boolean props are offered bare, expressions with a value', () => {
    const tag = parseWebTypes(fixture.webTypesPath).tags.find((t) => t.name === 'UserCard');
    assert.equal(tag?.attributes.find((a) => a.name === 'show-avatar')?.valueSet, 'v');
    assert.equal(tag?.attributes.find((a) => a.name === ':show-avatar')?.valueSet, undefined);
    assert.equal(tag?.attributes.find((a) => a.name === 'user-id')?.valueSet, undefined);
  });

  test('components without a source have no definition target', () => {
    const ghost = parseWebTypes(fixture.webTypesPath).components.find((c) => c.name === 'GhostWidget');
    assert.equal(ghost?.source, undefined);
    assert.equal(ghost?.attributes[0].source, undefined);
  });

  test('attributes without their own source fall back to the component source', () => {
    const file = path.join(fixture.root, 'fallback.web-types.json');
    const json = {
      contributions: {
        html: { elements: [{ name: 'A', source: { file: 'A.vue', offset: 7 }, attributes: [{ name: 'p' }] }] },
      },
    };
    const data = parseWebTypes(file, JSON.stringify(json));
    assert.equal(data.components[0].attributes[0].source?.offset, 7);
  });

  test('global attributes', () => {
    const data = parseWebTypes(fixture.webTypesPath);
    assert.deepEqual(
      data.globalAttributes.map((a) => a.name),
      ['x-tooltip'],
    );
  });

  test('description-markup "none" keeps plain strings', () => {
    const json = { contributions: { html: { elements: [{ name: 'A', description: 'plain *text*' }] } } };
    assert.equal(parseWebTypes('/x/wt.json', JSON.stringify(json)).tags[0].description, 'plain *text*');
  });

  test('vue-components flavour: props in kebab case + bound form, events with @', () => {
    const json = {
      framework: 'vue',
      contributions: {
        html: {
          'vue-components': [
            {
              name: 'DatePicker',
              source: { file: 'DatePicker.vue', offset: 3 },
              props: [{ name: 'modelValue', description: 'Value' }, { name: 'minDate' }],
              js: { events: [{ name: 'update:modelValue' }] },
            },
          ],
        },
      },
    };
    const data = parseWebTypes('/p/web-types.json', JSON.stringify(json));
    assert.deepEqual(
      data.tags[0].attributes.map((a) => a.name),
      ['model-value', ':model-value', 'min-date', ':min-date', '@update:modelValue'],
    );
    assert.equal(data.components[0].source?.file, path.resolve('/p/DatePicker.vue'));
  });

  test('legacy "tags" contribution is read like "elements"', () => {
    const json = { contributions: { html: { tags: [{ name: 'OldTag', attributes: [{ name: 'a' }] }] } } };
    assert.deepEqual(
      parseWebTypes('/x/w.json', JSON.stringify(json)).tags.map((t) => t.name),
      ['OldTag'],
    );
  });

  test('malformed entries are skipped, not fatal', () => {
    const json = {
      contributions: {
        html: {
          elements: [
            null,
            42,
            { description: 'no name' },
            { name: '' },
            { name: 'Ok', attributes: [{}, { name: 1 }, { name: 'a' }] },
          ],
          attributes: [{}, { name: 'g' }],
        },
      },
    };
    const data = parseWebTypes('/x/w.json', JSON.stringify(json));
    assert.deepEqual(
      data.tags.map((t) => t.name),
      ['Ok'],
    );
    assert.deepEqual(
      data.tags[0].attributes.map((a) => a.name),
      ['a'],
    );
    assert.deepEqual(
      data.globalAttributes.map((a) => a.name),
      ['g'],
    );
  });

  test('a file without contributions yields nothing', () => {
    assert.deepEqual(parseWebTypes('/x/w.json', '{}'), { tags: [], globalAttributes: [], components: [] });
  });

  test('invalid JSON throws (reported by the project loader)', () => {
    assert.throws(() => parseWebTypes('/x/w.json', '{ nope'));
  });
});

describe('discoverWebTypes', () => {
  test('package.json "web-types" string', () => {
    const fixture = createProject({ webTypesField: './web-types.json' });
    try {
      assert.deepEqual(discoverWebTypes(fixture.root), [fixture.webTypesPath]);
    } finally {
      fixture.cleanup();
    }
  });

  test('package.json "web-types" array', () => {
    const fixture = createProject({ webTypesField: ['web-types.json', 'types/more.json'] });
    try {
      assert.deepEqual(discoverWebTypes(fixture.root), [
        fixture.webTypesPath,
        path.join(fixture.root, 'types/more.json'),
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  test('falls back to <root>/web-types.json', () => {
    const fixture = createProject({ webTypesField: null });
    try {
      assert.deepEqual(discoverWebTypes(fixture.root), [fixture.webTypesPath]);
      fs.rmSync(fixture.webTypesPath);
      assert.deepEqual(discoverWebTypes(fixture.root), []);
    } finally {
      fixture.cleanup();
    }
  });

  test('configured paths win over package.json', () => {
    const fixture = createProject();
    try {
      assert.deepEqual(discoverWebTypes(fixture.root, ['custom/wt.json']), [path.join(fixture.root, 'custom/wt.json')]);
    } finally {
      fixture.cleanup();
    }
  });

  test('missing or broken package.json', () => {
    const fixture = createProject({ webTypesField: null });
    try {
      fs.writeFileSync(path.join(fixture.root, 'package.json'), '{ broken');
      assert.deepEqual(discoverWebTypes(fixture.root), [fixture.webTypesPath]);
      assert.equal(usesVue(fixture.root), false);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('usesVue', () => {
  test('dependency detection', () => {
    const withVue = createProject({ vue: true });
    const withoutVue = createProject({ vue: false });
    try {
      assert.equal(usesVue(withVue.root), true);
      assert.equal(usesVue(withoutVue.root), false);
    } finally {
      withVue.cleanup();
      withoutVue.cleanup();
    }
  });
});

describe('parseSettings', () => {
  test('flat and namespaced settings', () => {
    assert.deepEqual(parseSettings({ webTypes: ['a.json'], vue: false }), { webTypes: ['a.json'], vue: false });
    assert.deepEqual(parseSettings({ 'blade-html': { webTypes: 'a.json', vue: 'auto' } }), {
      webTypes: ['a.json'],
      vue: 'auto',
    });
  });

  test('invalid values are ignored', () => {
    assert.deepEqual(parseSettings({ webTypes: [1, 'b.json'], vue: 'yes' }), { webTypes: ['b.json'] });
    assert.deepEqual(parseSettings(null), {});
    assert.deepEqual(parseSettings(undefined), {});
    assert.deepEqual(parseSettings('x'), {});
  });
});
