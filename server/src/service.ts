/**
 * Language features for Blade documents, independent of the LSP connection (unit-testable).
 *
 * Each document is masked (see blade.ts) and fed to vscode-html-languageservice as HTML; the
 * masked text has the source's length and line breaks, so positions map 1:1. Requests that land
 * inside Blade/PHP code return nothing: the PHP language servers answer those.
 */
import * as fs from 'node:fs';
import type {
  CompletionList,
  DocumentHighlight,
  Hover,
  HTMLDocument,
  MarkupContent,
  Node,
  Position,
  Range,
} from 'vscode-html-languageservice';
import * as htmlLanguageService from 'vscode-html-languageservice';
import type { LocationLink } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { isInRegion, type MaskedBlade, maskBlade } from './blade.ts';
import type { Project } from './project.ts';
import { attributeKey, type Component, type SourceRef } from './webTypes.ts';

// Under Node (tests) the package resolves to its UMD build, whose re-exported enums are only on
// `default`; in the esbuild bundle it is the ESM build, which has no `default`.
const { TokenType } = (Reflect.get(htmlLanguageService, 'default') ?? htmlLanguageService) as Pick<
  typeof htmlLanguageService,
  'TokenType'
>;

interface Analysis {
  version: number;
  source: string;
  masked: MaskedBlade;
  html: TextDocument;
  htmlDocument: HTMLDocument;
}

interface AttributeAt {
  name: string;
  start: number;
  end: number;
}

export class BladeHtmlService {
  private analyses = new Map<string, Analysis>();
  private files = new Map<string, { mtime: number; document: TextDocument }>();

  /** Masked HTML view of a Blade document, cached per version. */
  analyze(document: TextDocument, project: Project): Analysis {
    const source = document.getText();
    const cached = this.analyses.get(document.uri);
    // The text check is cheap (same string instance while unchanged) and guards against clients
    // that reuse version numbers
    if (cached && cached.version === document.version && cached.source === source) {
      return cached;
    }
    const masked = maskBlade(source);
    const html = TextDocument.create(document.uri, 'html', document.version, masked.text);
    const analysis = {
      version: document.version,
      source,
      masked,
      html,
      htmlDocument: project.languageService.parseHTMLDocument(html),
    };
    this.analyses.set(document.uri, analysis);
    return analysis;
  }

  forget(uri: string): void {
    this.analyses.delete(uri);
  }

  complete(document: TextDocument, position: Position, project: Project): CompletionList | null {
    const { masked, html, htmlDocument } = this.analyze(document, project);
    const offset = document.offsetAt(position);
    if (isInRegion(masked.regions, offset)) {
      return null;
    }
    const list = project.languageService.doComplete(html, position, htmlDocument, {
      attributeDefaultValue: 'doublequotes',
    });

    const node = htmlDocument.findNodeAt(offset);
    const tag = node.tag;
    const inStartTag =
      tag !== undefined && offset > node.start && (node.startTagEnd === undefined || offset < node.startTagEnd);
    const component = inStartTag ? project.findComponent(tag) : undefined;
    const componentKeys = new Set(component?.attributes.map((a) => attributeKey(a.name)));
    // Props already bound in any form (`get-url` hides `:get-url` and `v-bind:get-url`)
    const bound = new Set<string>();
    if (component) {
      const current = attributeAt(project, masked.text, node, offset);
      for (const name of Object.keys(node.attributes ?? {})) {
        if (!current || name !== current.name) {
          bound.add(attributeKey(name));
        }
      }
    }

    list.items = list.items.filter((item) => {
      delete item.command; // `editor.action.triggerSuggest` is VS Code-only
      if (item.documentation && typeof item.documentation !== 'string') {
        item.documentation = { ...item.documentation, value: stripImages(item.documentation.value) };
      }
      if (!component) {
        return true;
      }
      const label = item.label;
      const key = attributeKey(label);
      if (!componentKeys.has(key)) {
        item.sortText = `1${label}`;
        return true;
      }
      if (bound.has(key)) {
        return false;
      }
      // The long `v-bind:` / `v-on:` forms only when they are being typed
      if (/^v-(?:bind|on):/.test(label)) {
        const edit = item.textEdit;
        const start = edit && 'range' in edit ? document.offsetAt(edit.range.start) : offset;
        if (!document.getText().slice(start, offset).startsWith('v-')) {
          return false;
        }
      }
      item.sortText = `0${label}`;
      return true;
    });
    return list;
  }

  hover(document: TextDocument, position: Position, project: Project): Hover | null {
    const { masked, html, htmlDocument } = this.analyze(document, project);
    const offset = document.offsetAt(position);
    if (isInRegion(masked.regions, offset)) {
      return null;
    }
    const hover = project.languageService.doHover(html, position, htmlDocument, {
      documentation: true,
      references: true,
    });
    if (hover) {
      if (typeof hover.contents === 'object' && 'kind' in hover.contents) {
        hover.contents = { ...hover.contents, value: stripImages(hover.contents.value) };
      }
      return hover;
    }
    // What the stock lookup misses: kebab/lower-case component tags (`<user-card>`) and
    // attribute forms without an exact entry (`:get-url.camel`, `@on-file-loaded.once`)
    const node = htmlDocument.findNodeAt(offset);
    const tagData = node.tag ? project.findTagData(node.tag) : undefined;
    if (!node.tag || !tagData) {
      return null;
    }
    const tagName = tagNameRangeAt(node, offset);
    if (tagName) {
      return markdownHover(tagData.description, rangeOf(document, tagName[0], tagName[1]));
    }
    const attribute = attributeAt(project, masked.text, node, offset);
    if (!attribute) {
      return null;
    }
    const key = attributeKey(attribute.name);
    const data = tagData.attributes.find((a) => attributeKey(a.name) === key);
    return markdownHover(data?.description, rangeOf(document, attribute.start, attribute.end));
  }

  /** Vue component tag / prop / event → its definition in the component source. */
  definition(document: TextDocument, position: Position, project: Project): LocationLink[] | null {
    const { masked, htmlDocument } = this.analyze(document, project);
    const offset = document.offsetAt(position);
    if (isInRegion(masked.regions, offset)) {
      return null;
    }
    const node = htmlDocument.findNodeAt(offset);
    const component = node.tag ? project.findComponent(node.tag) : undefined;
    if (!node.tag || !component) {
      return null;
    }
    const tagName = tagNameRangeAt(node, offset);
    if (tagName) {
      return this.link(component.source, rangeOf(document, tagName[0], tagName[1]));
    }
    const attribute = attributeAt(project, masked.text, node, offset);
    if (!attribute) {
      return null;
    }
    const target = findAttribute(component, attribute.name);
    return target
      ? this.link(target.source ?? component.source, rangeOf(document, attribute.start, attribute.end))
      : null;
  }

  linkedEditingRanges(document: TextDocument, position: Position, project: Project): Range[] | null {
    const { masked, html, htmlDocument } = this.analyze(document, project);
    if (isInRegion(masked.regions, document.offsetAt(position))) {
      return null;
    }
    return project.languageService.findLinkedEditingRanges(html, position, htmlDocument);
  }

  documentHighlights(document: TextDocument, position: Position, project: Project): DocumentHighlight[] {
    const { masked, html, htmlDocument } = this.analyze(document, project);
    if (isInRegion(masked.regions, document.offsetAt(position))) {
      return [];
    }
    return project.languageService.findDocumentHighlights(html, position, htmlDocument);
  }

  private link(source: SourceRef | undefined, origin: Range): LocationLink[] | null {
    const target = source && this.readFile(source.file);
    if (!source || !target) {
      return null;
    }
    const offset = Math.min(source.offset, target.getText().length);
    const text = target.getText();
    let end = offset;
    while (end < text.length && /[\w$-]/.test(text[end])) {
      end++;
    }
    const range = { start: target.positionAt(offset), end: target.positionAt(end) };
    return [{ originSelectionRange: origin, targetUri: target.uri, targetRange: range, targetSelectionRange: range }];
  }

  private readFile(file: string): TextDocument | undefined {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      const cached = this.files.get(file);
      if (cached && cached.mtime === mtime) {
        return cached.document;
      }
      const document = TextDocument.create(URI.file(file).toString(), 'vue', 0, fs.readFileSync(file, 'utf8'));
      this.files.set(file, { mtime, document });
      return document;
    } catch {
      return undefined;
    }
  }
}

/** [start, end) of the start or end tag name of `node` under `offset`. */
function tagNameRangeAt(node: Node, offset: number): [number, number] | undefined {
  const length = node.tag?.length ?? 0;
  const startName = node.start + 1;
  if (offset >= startName && offset <= startName + length) {
    return [startName, startName + length];
  }
  if (node.endTagStart !== undefined) {
    const endName = node.endTagStart + 2;
    if (offset >= endName && offset <= endName + length) {
      return [endName, endName + length];
    }
  }
  return undefined;
}

function markdownHover(description: string | MarkupContent | undefined, range: Range): Hover | null {
  if (!description) {
    return null;
  }
  const contents: MarkupContent =
    typeof description === 'string' ? { kind: 'markdown', value: description } : description;
  return { contents: { ...contents, value: stripImages(contents.value) }, range };
}

/** Attribute name token under `offset` in the start tag of `node`. */
function attributeAt(project: Project, text: string, node: Node, offset: number): AttributeAt | undefined {
  if (node.startTagEnd !== undefined && offset > node.startTagEnd) {
    return undefined;
  }
  const scanner = project.languageService.createScanner(text, node.start);
  let token = scanner.scan();
  while (token !== TokenType.EOS && scanner.getTokenOffset() <= offset) {
    if (token === TokenType.StartTagClose || token === TokenType.StartTagSelfClose) {
      return undefined;
    }
    if (token === TokenType.AttributeName && offset >= scanner.getTokenOffset() && offset <= scanner.getTokenEnd()) {
      return { name: scanner.getTokenText(), start: scanner.getTokenOffset(), end: scanner.getTokenEnd() };
    }
    token = scanner.scan();
  }
  return undefined;
}

function findAttribute(component: Component, name: string) {
  const key = attributeKey(name);
  return component.attributes.find((a) => attributeKey(a.name) === key);
}

/** Drops the inline base64 "Baseline" SVG badges (rendered as noise by most editors). */
export function stripImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\(data:[^)]*\)\s*/g, '');
}

function rangeOf(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}
