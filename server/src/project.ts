/**
 * Per-workspace-root state: the web-types data of the project, reloaded when a web-types file or
 * package.json changes, and an HTML language service configured with it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getLanguageService,
  type HTMLDataV1,
  type IAttributeData,
  type IHTMLDataProvider,
  type ITagData,
  type IValueData,
  type LanguageService,
  newHTMLDataProvider,
} from 'vscode-html-languageservice';
import { vueData } from './vue.ts';
import {
  type Component,
  componentKey,
  discoverWebTypes,
  isRecord,
  isString,
  parseWebTypes,
  usesVue,
} from './webTypes.ts';

export interface Settings {
  /** Web-types files relative to the workspace root; default: package.json "web-types". */
  webTypes?: string[];
  /** Built-in Vue directives/components: true, false or "auto" (project depends on vue). */
  vue?: boolean | 'auto';
}

export function parseSettings(raw: unknown): Settings {
  const outer = isRecord(raw) ? raw : {};
  const source = isRecord(outer['blade-html']) ? outer['blade-html'] : outer;
  const settings: Settings = {};
  if (typeof source.webTypes === 'string') {
    settings.webTypes = [source.webTypes];
  } else if (Array.isArray(source.webTypes)) {
    settings.webTypes = source.webTypes.filter(isString);
  }
  if (typeof source.vue === 'boolean' || source.vue === 'auto') {
    settings.vue = source.vue;
  }
  return settings;
}

export class Project {
  /** Minimum time between two stat checks of the web-types files. */
  static refreshIntervalMs = 1000;

  readonly languageService: LanguageService = getLanguageService();
  private components = new Map<string, Component>();
  private tags = new Map<string, ITagData>();
  private stamp = '';
  private checkedAt = 0;

  /** Absolute workspace root path, or undefined for files outside any workspace folder. */
  readonly root: string | undefined;
  private settings: Settings;
  private readonly log: (message: string) => void;

  constructor(root: string | undefined, settings: Settings, log: (message: string) => void = () => {}) {
    this.root = root;
    this.settings = settings;
    this.log = log;
    this.refresh(true);
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.refresh(true);
  }

  /** Reloads the data when a watched file changed; cheap (stat only), throttled. */
  refresh(force = false): void {
    const now = Date.now();
    if (!force && now - this.checkedAt < Project.refreshIntervalMs) {
      return;
    }
    this.checkedAt = now;
    if (!this.root) {
      if (force) {
        this.load([], this.settings.vue === true);
      }
      return;
    }
    const files = discoverWebTypes(this.root, this.settings.webTypes);
    const stamp = [path.join(this.root, 'package.json'), ...files].map((f) => `${f}:${mtime(f)}`).join('|');
    if (force || stamp !== this.stamp) {
      this.stamp = stamp;
      const vue =
        this.settings.vue === undefined || this.settings.vue === 'auto' ? usesVue(this.root) : this.settings.vue;
      this.load(files, vue);
    }
  }

  private load(files: string[], vue: boolean): void {
    const providers: IHTMLDataProvider[] = [];
    this.components.clear();
    this.tags.clear();
    for (const file of files) {
      try {
        const data = parseWebTypes(file);
        for (const component of data.components) {
          this.components.set(componentKey(component.name), component);
        }
        for (const tag of data.tags) {
          this.tags.set(componentKey(tag.name), tag);
        }
        providers.push(
          new ComponentDataProvider(`web-types:${file}`, {
            version: 1.1,
            tags: data.tags,
            globalAttributes: data.globalAttributes,
          }),
        );
        this.log(`Loaded ${data.components.length} components from ${file}`);
      } catch (error) {
        if (fs.existsSync(file)) {
          this.log(`Cannot read web-types ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (vue) {
      providers.push(newHTMLDataProvider('vue', vueData));
    }
    this.languageService.setDataProviders(true, providers);
  }

  findComponent(tag: string): Component | undefined {
    return this.components.get(componentKey(tag));
  }

  findTagData(tag: string): ITagData | undefined {
    return this.tags.get(componentKey(tag));
  }

  get componentCount(): number {
    return this.components.size;
  }
}

/**
 * HTML data provider for components: attributes and values are looked up by the normalised
 * component name, so `<user-card>` and `<usercard>` get the props of `UserCard` (the stock
 * provider only lower-cases the name).
 */
class ComponentDataProvider implements IHTMLDataProvider {
  private readonly inner: IHTMLDataProvider;
  private readonly names = new Map<string, string>();

  constructor(id: string, data: HTMLDataV1) {
    this.inner = newHTMLDataProvider(id, data);
    for (const tag of data.tags ?? []) {
      this.names.set(componentKey(tag.name), tag.name);
    }
  }

  getId(): string {
    return this.inner.getId();
  }

  isApplicable(): boolean {
    return true;
  }

  provideTags(): ITagData[] {
    return this.inner.provideTags();
  }

  provideAttributes(tag: string): IAttributeData[] {
    return this.inner.provideAttributes(this.names.get(componentKey(tag)) ?? tag);
  }

  provideValues(tag: string, attribute: string): IValueData[] {
    return this.inner.provideValues(this.names.get(componentKey(tag)) ?? tag, attribute);
  }
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
