# Blade HTML for Zed

HTML language features in Laravel Blade templates (`*.blade.php`), and the Vue components your
project describes in [web-types](https://github.com/JetBrains/web-types).

Zed's HTML language server only serves HTML files, and the [Blade](https://github.com/bajrangCoder/zed-laravel-blade)
extension brings syntax highlighting but no HTML intelligence. This extension adds a language
server for Blade that runs next to the PHP ones (Zed merges their results):

- **HTML**: tag, attribute and attribute value completion, documentation on hover, matching tag
  highlight, and linked editing of a tag pair.
- **web-types components** (e.g. Vue components mounted from Blade): tag and prop/event completion
  (props first, already bound ones hidden), hover with the component description, and
  **go to definition** — on the tag it opens the component source, on a prop or event its
  declaration. Any binding form works: `get-url`, `:get-url`, `v-bind:get-url`, `@saved`,
  `v-on:saved`, PascalCase or kebab-case tags.
- **Vue built-ins** when the project depends on `vue`: `v-if`, `v-for`, `v-model`…,
  `<component>`, `<transition>`, `<keep-alive>`, `<teleport>`.

Blade code itself (`{{ }}`, `{!! !!}`, `@if(…)`, `@php … @endphp`, `{{-- --}}`, `<?php ?>`) is
left to the PHP language servers; Vue's `@event` attributes inside tags are told apart from Blade
directives.

## Install

Install **Blade** and **Blade HTML LSP** from `zed: extensions`. On first use the extension
downloads its language server (one JavaScript file from this repository's GitHub release of the
same version) and runs it on the Node.js that Zed manages.

Until the extension is listed in the registry, install it from a clone: `zed: install dev
extension` and pick the cloned directory (Zed builds it with Rust, so `rustup` must be on Zed's
`PATH`). The server is still downloaded from the release.

The server is enabled for Blade by default. If your settings list Blade language servers
explicitly, keep `"..."` in the list or add `"blade-html"`:

```jsonc
"languages": {
  "Blade": {
    "language_servers": ["blade-html", "..."]
  }
}
```

## web-types

The server reads the files named by the `web-types` field of the workspace's `package.json`
(string or array) — the JetBrains convention — or `web-types.json` at the root. Supported:
`contributions.html.elements` / `tags` with `attributes`, `contributions.html["vue-components"]`
(`props`, `js.events`) and global `contributions.html.attributes`. `source: { file, offset }`
(relative to the web-types file) is the definition target. The files are reloaded when they
change.

## Settings

```jsonc
"lsp": {
  "blade-html": {
    "settings": {
      // web-types files, relative to the workspace root (default: package.json "web-types")
      "webTypes": ["web-types.json"],
      // Vue built-in directives and components: "auto" (project depends on vue), true or false
      "vue": "auto"
    },
    // Optional: run another build of the server on Zed's Node.js (or set "path" for another binary)
    "binary": { "arguments": ["/path/to/blade-html-server.cjs", "--stdio"] }
  }
}
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
