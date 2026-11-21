/**
 * blade-html language server: HTML tags/attributes and web-types (Vue components) for Laravel
 * Blade templates. Runs over stdio; started by the Zed extension (see ../../src/lib.rs). Bundled as CommonJS (.cjs) so it runs regardless of the nearest package.json "type".
 */
import {
  createConnection,
  type InitializeParams,
  type InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { Project, parseSettings, type Settings } from './project.ts';
import { BladeHtmlService } from './service.ts';

/** Replaced by esbuild with server/package.json "version"; unset when run from source (tests). */
declare const BLADE_HTML_VERSION: string | undefined;
const SERVER_VERSION = typeof BLADE_HTML_VERSION === 'string' ? BLADE_HTML_VERSION : 'dev';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const service = new BladeHtmlService();

let settings: Settings = {};
let roots: string[] = [];
const projects = new Map<string, Project>();
let looseProject: Project | undefined;
let workspaceFolderEvents = false;

const log = (message: string) => connection.console.log(message);

function projectFor(uri: string): Project {
  const file = URI.parse(uri).fsPath;
  const root = roots
    .filter((r) => file === r || file.startsWith(r.endsWith('/') ? r : `${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) {
    looseProject ??= new Project(undefined, settings, log);
    return looseProject;
  }
  let project = projects.get(root);
  if (!project) {
    project = new Project(root, settings, log);
    projects.set(root, project);
  }
  project.refresh();
  return project;
}

function withDocument<P extends { textDocument: { uri: string } }, R>(
  handler: (document: TextDocument, params: P, project: Project) => R,
  fallback: R,
) {
  return (params: P): R => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return fallback;
    }
    try {
      return handler(document, params, projectFor(document.uri));
    } catch (error) {
      connection.console.error(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return fallback;
    }
  };
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  settings = parseSettings(params.initializationOptions);
  workspaceFolderEvents = params.capabilities.workspace?.workspaceFolders === true;
  const folders = params.workspaceFolders?.map((f) => f.uri) ?? (params.rootUri ? [params.rootUri] : []);
  roots = folders.map((uri) => URI.parse(uri).fsPath);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ['<', '/', ':', '@', '"', "'", '='] },
      hoverProvider: true,
      definitionProvider: true,
      linkedEditingRangeProvider: true,
      documentHighlightProvider: true,
      workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
    },
    serverInfo: { name: 'blade-html', version: SERVER_VERSION },
  };
});

connection.onInitialized(() => {
  for (const root of roots) {
    projectFor(URI.file(root).toString());
  }
  if (!workspaceFolderEvents) {
    return;
  }
  connection.workspace.onDidChangeWorkspaceFolders((event) => {
    for (const removed of event.removed) {
      const root = URI.parse(removed.uri).fsPath;
      roots = roots.filter((r) => r !== root);
      projects.delete(root);
    }
    roots.push(...event.added.map((f) => URI.parse(f.uri).fsPath));
  });
});

connection.onDidChangeConfiguration((change) => {
  if (change.settings === null || change.settings === undefined) {
    return;
  }
  const next = parseSettings(change.settings);
  if (JSON.stringify(next) === JSON.stringify(settings)) {
    return;
  }
  settings = next;
  for (const project of projects.values()) {
    project.updateSettings(settings);
  }
  looseProject?.updateSettings(settings);
});

documents.onDidClose((event) => service.forget(event.document.uri));

connection.onCompletion(withDocument((doc, params, project) => service.complete(doc, params.position, project), null));
connection.onHover(withDocument((doc, params, project) => service.hover(doc, params.position, project), null));
connection.onDefinition(
  withDocument((doc, params, project) => service.definition(doc, params.position, project), null),
);
connection.languages.onLinkedEditingRange(
  withDocument((doc, params, project) => {
    const ranges = service.linkedEditingRanges(doc, params.position, project);
    return ranges ? { ranges } : null;
  }, null),
);
connection.onDocumentHighlight(
  withDocument((doc, params, project) => service.documentHighlights(doc, params.position, project), []),
);

documents.listen(connection);
connection.listen();
