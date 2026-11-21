/**
 * JetBrains web-types (https://github.com/JetBrains/web-types) → HTML custom data + a lookup
 * index for go-to-definition.
 *
 * Supported contributions: `contributions.html.elements` / `.tags` (with `attributes`),
 * `contributions.html["vue-components"]` (`props`, `js.events`) and global
 * `contributions.html.attributes`. `source: {file, offset}` is resolved relative to the
 * web-types file and becomes the definition target.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IAttributeData, IReference, ITagData, MarkupContent } from 'vscode-html-languageservice';
import { URI } from 'vscode-uri';

export interface SourceRef {
  /** Absolute path of the source file. */
  file: string;
  /** UTF-16 offset in the file. */
  offset: number;
}

export interface ComponentAttribute {
  name: string;
  source?: SourceRef;
}

export interface Component {
  name: string;
  source?: SourceRef;
  attributes: ComponentAttribute[];
}

export interface WebTypesData {
  tags: ITagData[];
  globalAttributes: IAttributeData[];
  components: Component[];
}

/** Vue resolves components by name case-insensitively in DOM templates; kebab ≈ Pascal. */
export function componentKey(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Key of the prop / event an attribute binds, so `:get-url`, `v-bind:get-url`, `get-url` and the
 * `getUrl` prop meet: binding prefix and modifiers are dropped, then case and dashes are ignored.
 */
export function attributeKey(name: string): string {
  let key = name;
  const prefix = /^(?:v-bind:|v-on:|v-slot:|v-model:|[:@#])/.exec(key);
  let kind = '';
  if (prefix) {
    kind =
      prefix[0] === 'v-on:' || prefix[0] === '@'
        ? 'event:'
        : prefix[0].startsWith('v-slot') || prefix[0] === '#'
          ? 'slot:'
          : '';
    key = key.slice(prefix[0].length);
  }
  const dot = key.indexOf('.');
  if (dot > 0) {
    key = key.slice(0, dot); // modifiers: `.prevent`, `.sync`, `.camel`
  }
  return kind + key.toLowerCase().replace(/[-_]/g, '');
}

export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

interface RawSource {
  file?: unknown;
  offset?: unknown;
}

interface RawItem {
  name?: unknown;
  description?: unknown;
  'doc-url'?: unknown;
  source?: RawSource;
  attributes?: RawItem[];
  props?: RawItem[];
  js?: { events?: RawItem[] };
  events?: RawItem[];
  value?: { kind?: unknown; type?: unknown };
}

/** Parses one web-types file. Throws on unreadable / invalid JSON. */
export function parseWebTypes(file: string, content: string = fs.readFileSync(file, 'utf8')): WebTypesData {
  const json = JSON.parse(content);
  const dir = path.dirname(file);
  const markup: string = typeof json?.['description-markup'] === 'string' ? json['description-markup'] : 'none';
  const html = json?.contributions?.html ?? {};

  const describe = (item: RawItem): string | MarkupContent | undefined => {
    if (typeof item.description !== 'string' || item.description === '') {
      return undefined;
    }
    return markup === 'markdown' || markup === 'html'
      ? { kind: 'markdown', value: item.description }
      : item.description;
  };
  const references = (item: RawItem, source?: SourceRef): IReference[] | undefined => {
    const refs: IReference[] = [];
    if (typeof item['doc-url'] === 'string') {
      refs.push({ name: 'Documentation', url: item['doc-url'] });
    }
    if (source) {
      refs.push({ name: path.basename(source.file), url: URI.file(source.file).toString() });
    }
    return refs.length ? refs : undefined;
  };
  const sourceOf = (item: RawItem): SourceRef | undefined => {
    const src = item.source;
    if (src && typeof src.file === 'string') {
      return {
        file: path.resolve(dir, src.file),
        offset: typeof src.offset === 'number' && src.offset >= 0 ? src.offset : 0,
      };
    }
    return undefined;
  };
  const attributeData = (attr: RawItem): IAttributeData => {
    const data: IAttributeData = { name: String(attr.name) };
    const description = describe(attr);
    if (description) {
      data.description = description;
    }
    // Plain boolean props are usually written bare (`<Comp disabled>`)
    if (attr.value?.kind === 'plain' && attr.value?.type === 'boolean' && !String(attr.name).startsWith(':')) {
      data.valueSet = 'v';
    }
    const refs = references(attr);
    if (refs) {
      data.references = refs;
    }
    return data;
  };

  const tags: ITagData[] = [];
  const components: Component[] = [];
  const addComponent = (item: RawItem, attributes: RawItem[]): void => {
    if (typeof item.name !== 'string' || item.name === '') {
      return;
    }
    const source = sourceOf(item);
    const usable = attributes.filter((a) => typeof a.name === 'string' && a.name !== '');
    const tag: ITagData = { name: item.name, attributes: usable.map(attributeData) };
    const description = describe(item);
    if (description) {
      tag.description = description;
    }
    const refs = references(item, source);
    if (refs) {
      tag.references = refs;
    }
    tags.push(tag);
    components.push({
      name: item.name,
      source,
      attributes: usable.map((a) => ({ name: String(a.name), source: sourceOf(a) ?? source })),
    });
  };

  for (const element of [...asArray(html.elements), ...asArray(html.tags)]) {
    addComponent(element, asArray(element.attributes));
  }
  // Vue framework flavour: props + events, expanded to the attribute forms used in templates
  for (const component of asArray(html['vue-components'])) {
    const attributes: RawItem[] = [];
    for (const prop of asArray(component.props)) {
      if (typeof prop.name !== 'string') {
        continue;
      }
      const kebab = toKebabCase(prop.name);
      attributes.push({ ...prop, name: kebab }, { ...prop, name: `:${kebab}` });
    }
    for (const event of [...asArray(component.js?.events), ...asArray(component.events)]) {
      if (typeof event.name === 'string') {
        attributes.push({ ...event, name: `@${event.name}` });
      }
    }
    addComponent(component, attributes);
  }

  const globalAttributes = asArray(html.attributes)
    .filter((a) => typeof a.name === 'string' && a.name !== '')
    .map(attributeData);

  return { tags, globalAttributes, components };
}

function asArray(value: unknown): RawItem[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as RawItem[]) : [];
}

/**
 * Web-types files of a project: explicit `configured` paths (relative to `root`), else the
 * `web-types` field of `<root>/package.json` (string or array, the JetBrains convention), else
 * `<root>/web-types.json` when it exists.
 */
export function discoverWebTypes(root: string, configured?: string[]): string[] {
  if (configured?.length) {
    return configured.map((p) => path.resolve(root, p));
  }
  const pkg = readPackageJson(root);
  const field = pkg?.['web-types'];
  const fromPackage = typeof field === 'string' ? [field] : Array.isArray(field) ? field.filter(isString) : [];
  if (fromPackage.length) {
    return fromPackage.map((p) => path.resolve(root, p));
  }
  const fallback = path.join(root, 'web-types.json');
  return fs.existsSync(fallback) ? [fallback] : [];
}

export function readPackageJson(root: string): Record<string, unknown> | undefined {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return isRecord(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Whether the project depends on Vue (enables the built-in Vue directive data). */
export function usesVue(root: string): boolean {
  const pkg = readPackageJson(root);
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((field) => {
    const dependencies = pkg?.[field];
    return isRecord(dependencies) && dependencies.vue !== undefined;
  });
}
