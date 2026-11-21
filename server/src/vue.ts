/**
 * Vue 3 built-in directives and components as HTML custom data. Blade pages are often mounted
 * as in-DOM Vue templates, so `v-if`, `v-for`, `<component :is>`, `<transition>`… appear in
 * Blade markup. Enabled when the project depends on `vue` (or forced by the `vue` setting).
 */
import type { HTMLDataV1, IAttributeData, ITagData } from 'vscode-html-languageservice';

const API = 'https://vuejs.org/api/';

function attr(name: string, description: string, anchor: string, bare = false): IAttributeData {
  return {
    name,
    description,
    references: [{ name: 'Vue API', url: API + anchor }],
    ...(bare ? { valueSet: 'v' } : {}),
  };
}

const directives: IAttributeData[] = [
  attr(
    'v-if',
    'Conditionally render the element based on the truthy-ness of the expression.',
    'built-in-directives.html#v-if',
  ),
  attr('v-else-if', 'Denote the "else if block" for `v-if`. Can be chained.', 'built-in-directives.html#v-else-if'),
  attr(
    'v-else',
    'Denote the "else block" for `v-if` or a `v-if` / `v-else-if` chain.',
    'built-in-directives.html#v-else',
    true,
  ),
  attr(
    'v-for',
    'Render the element or template block multiple times based on the source data (`item in items`).',
    'built-in-directives.html#v-for',
  ),
  attr(
    'v-show',
    "Toggle the element's visibility (`display`) based on the truthy-ness of the expression.",
    'built-in-directives.html#v-show',
  ),
  attr(
    'v-model',
    'Create a two-way binding on a form input element or a component.',
    'built-in-directives.html#v-model',
  ),
  attr('v-html', "Update the element's `innerHTML`.", 'built-in-directives.html#v-html'),
  attr('v-text', "Update the element's text content.", 'built-in-directives.html#v-text'),
  attr(
    'v-bind',
    'Dynamically bind one or more attributes, or a component prop, to an expression. Shorthand: `:`.',
    'built-in-directives.html#v-bind',
  ),
  attr('v-on', 'Attach an event listener to the element. Shorthand: `@`.', 'built-in-directives.html#v-on'),
  attr(
    'v-slot',
    'Denote named slots or scoped slots that expect to receive props. Shorthand: `#`.',
    'built-in-directives.html#v-slot',
  ),
  attr(
    'v-once',
    'Render the element and component once only, and skip future updates.',
    'built-in-directives.html#v-once',
    true,
  ),
  attr('v-pre', 'Skip compilation for this element and all its children.', 'built-in-directives.html#v-pre', true),
  attr('v-cloak', 'Hide un-compiled template until it is ready.', 'built-in-directives.html#v-cloak', true),
  attr(
    'v-memo',
    'Memoize a sub-tree of the template; re-render only when one of the dependency values changes.',
    'built-in-directives.html#v-memo',
  ),
  attr(
    'key',
    "Hint for Vue's virtual DOM algorithm to identify vnodes (`:key`).",
    'built-in-special-attributes.html#key',
  ),
  attr('ref', 'Register a template ref to an element or a child component.', 'built-in-special-attributes.html#ref'),
  attr(
    'is',
    'Bind dynamic components; with the `vue:` prefix renders a component in in-DOM templates.',
    'built-in-special-attributes.html#is',
  ),
];

function tag(name: string, description: string, anchor: string, attributes: IAttributeData[] = []): ITagData {
  return { name, description, attributes, references: [{ name: 'Vue API', url: API + anchor }] };
}

const tags: ITagData[] = [
  tag(
    'component',
    'A "meta component" for rendering dynamic components or elements (`:is`).',
    'built-in-special-elements.html#component',
    [attr('is', 'The component (name, definition) or element to render.', 'built-in-special-elements.html#component')],
  ),
  tag('slot', 'Denotes slot content outlets in templates.', 'built-in-special-elements.html#slot', [
    attr('name', 'The slot name.', 'built-in-special-elements.html#slot'),
  ]),
  tag(
    'transition',
    'Provides animated transition effects to a single element or component.',
    'built-in-components.html#transition',
    [
      attr('name', 'Used to automatically generate transition CSS class names.', 'built-in-components.html#transition'),
      attr('appear', 'Whether to apply transition on initial render.', 'built-in-components.html#transition', true),
      attr(
        'mode',
        'Controls the timing sequence of leaving/entering transitions (`in-out` / `out-in`).',
        'built-in-components.html#transition',
      ),
      attr('css', 'Whether to apply CSS transition classes.', 'built-in-components.html#transition'),
      attr(
        'type',
        'Transition event type to wait for (`transition` / `animation`).',
        'built-in-components.html#transition',
      ),
      attr('duration', 'Explicit durations of the transition.', 'built-in-components.html#transition'),
    ],
  ),
  tag(
    'transition-group',
    'Provides transition effects for multiple elements or components in a list.',
    'built-in-components.html#transitiongroup',
    [
      attr('tag', 'Element to render as a wrapper (default: none).', 'built-in-components.html#transitiongroup'),
      attr(
        'move-class',
        'Customize the CSS class applied during move transition.',
        'built-in-components.html#transitiongroup',
      ),
      attr(
        'name',
        'Used to automatically generate transition CSS class names.',
        'built-in-components.html#transitiongroup',
      ),
    ],
  ),
  tag('keep-alive', 'Caches dynamically toggled components wrapped inside.', 'built-in-components.html#keepalive', [
    attr('include', 'Only components with matching names will be cached.', 'built-in-components.html#keepalive'),
    attr('exclude', 'Any component with a matching name will not be cached.', 'built-in-components.html#keepalive'),
    attr('max', 'The maximum number of component instances to cache.', 'built-in-components.html#keepalive'),
  ]),
  tag('teleport', 'Renders its slot content to another part of the DOM.', 'built-in-components.html#teleport', [
    attr('to', 'Required. Target container (selector or element).', 'built-in-components.html#teleport'),
    attr(
      'disabled',
      'When true, the content stays in its original location.',
      'built-in-components.html#teleport',
      true,
    ),
    attr(
      'defer',
      'Resolve the target after other parts of the app have mounted.',
      'built-in-components.html#teleport',
      true,
    ),
  ]),
  tag('suspense', 'Orchestrates async dependencies in a component tree.', 'built-in-components.html#suspense'),
];

export const vueData: HTMLDataV1 = { version: 1.1, tags, globalAttributes: directives };
