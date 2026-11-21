/**
 * Turns a Blade template into plain HTML of the same length for vscode-html-languageservice.
 *
 * Every Blade construct (comments, echoes, directives with their arguments, `@php` blocks, raw
 * PHP tags) is replaced by spaces, keeping line breaks, so offsets and line/character positions
 * stay identical between the Blade source and the masked HTML. The masked ranges are returned
 * too: language features are suppressed inside them (that is PHP, served by the PHP servers).
 */

export interface MaskedBlade {
  /** The HTML text: same length and same line breaks as the source. */
  text: string;
  /** Sorted, non-overlapping [start, end) ranges of masked Blade code. */
  regions: Array<[number, number]>;
}

const DIRECTIVE_RE = /@([A-Za-z_]\w*(?:::\w+)?)/y;
// Vue event shorthand inside a start tag: `@click="…"`, `@click.prevent="…"`,
// `@update:model-value="…"`. Blade directives are never followed by `=`.
const VUE_EVENT_RE = /@[\w-]+(?:[.:][\w-]+)*\s*=/y;
const TAG_NAME_RE = /<(\/?)([A-Za-z][\w:.-]*)/y;
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

export function maskBlade(source: string): MaskedBlade {
  const n = source.length;
  const regions: Array<[number, number]> = [];
  const mask = (start: number, end: number): number => {
    if (end > start) {
      regions.push([start, end]);
    }
    return end;
  };
  const endOfLine = (from: number): number => {
    const eol = source.indexOf('\n', from);
    return eol < 0 ? n : eol;
  };
  /** End (exclusive) of `close`, searched from `from`; falls back to the end of the line. */
  const closeOrEol = (from: number, close: string): number => {
    const at = source.indexOf(close, from);
    return at < 0 ? endOfLine(from) : at + close.length;
  };

  let inTag = false; // inside `<name …>` (attribute area)
  let tagName = '';
  let closingTag = false;
  let quote = ''; // attribute value quote inside a tag
  let rawTag = ''; // inside <script>/<style>…: no tag tracking until its end tag
  let inComment = false; // inside <!-- … -->

  let i = 0;
  while (i < n) {
    const c = source[i];

    // --- Blade constructs: masked everywhere, including attribute values and raw text ---
    if (c === '{' && source[i + 1] === '{' && source[i + 2] === '-' && source[i + 3] === '-') {
      const end = source.indexOf('--}}', i + 4);
      i = mask(i, end < 0 ? n : end + 4);
      continue;
    }
    if (c === '{' && source[i + 1] === '!' && source[i + 2] === '!') {
      i = mask(i, closeOrEol(i + 3, '!!}'));
      continue;
    }
    if (c === '{' && source[i + 1] === '{') {
      i = mask(i, closeOrEol(i + 2, '}}'));
      continue;
    }
    if (c === '<' && source[i + 1] === '?' && (source.startsWith('php', i + 2) || source[i + 2] === '=')) {
      const end = source.indexOf('?>', i + 2);
      i = mask(i, end < 0 ? n : end + 2);
      continue;
    }
    if (c === '@') {
      // `@@if` prints a literal `@if`; `@{{ … }}` prints a literal `{{ … }}` (Vue interpolation)
      if (source[i + 1] === '@') {
        i += 2;
        continue;
      }
      if (source[i + 1] === '{' && source[i + 2] === '{') {
        i = mask(i, closeOrEol(i + 3, '}}'));
        continue;
      }
      const prev = i > 0 ? source[i - 1] : '';
      if (!/[\w.]/.test(prev)) {
        VUE_EVENT_RE.lastIndex = i;
        const isVueEvent = inTag && !quote && VUE_EVENT_RE.test(source);
        DIRECTIVE_RE.lastIndex = i;
        const match = isVueEvent ? null : DIRECTIVE_RE.exec(source);
        if (match) {
          i = maskDirective(source, i, match[1], i + match[0].length, mask, endOfLine);
          continue;
        }
      }
    }

    // --- HTML structure: only to tell attribute areas (Vue `@event`) from text ---
    if (inComment) {
      if (c === '-' && source.startsWith('-->', i)) {
        inComment = false;
        i += 3;
        continue;
      }
    } else if (rawTag) {
      if (c === '<' && source[i + 1] === '/' && source.substr(i + 2, rawTag.length).toLowerCase() === rawTag) {
        rawTag = '';
        continue; // re-read as an end tag
      }
    } else if (!inTag) {
      if (c === '<' && source.startsWith('<!--', i)) {
        inComment = true;
        i += 4;
        continue;
      }
      TAG_NAME_RE.lastIndex = i;
      const tag = c === '<' ? TAG_NAME_RE.exec(source) : null;
      if (tag) {
        inTag = true;
        closingTag = tag[1] === '/';
        tagName = tag[2].toLowerCase();
        i += tag[0].length;
        continue;
      }
    } else if (quote) {
      if (c === quote) {
        quote = '';
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      inTag = false;
      if (!closingTag && source[i - 1] !== '/' && RAW_TEXT_TAGS.has(tagName)) {
        rawTag = tagName;
      }
    }
    i++;
  }

  return { text: applyMask(source, regions), regions };
}

/** Masks `@name` at `start` plus its argument list / block; returns the index after it. */
function maskDirective(
  source: string,
  start: number,
  name: string,
  nameEnd: number,
  mask: (start: number, end: number) => number,
  endOfLine: (from: number) => number,
): number {
  let j = nameEnd;
  while (source[j] === ' ' || source[j] === '\t') {
    j++;
  }
  const hasArgs = source[j] === '(';

  // `@php … @endphp` (without arguments) is a PHP block
  if (name === 'php' && !hasArgs) {
    const end = source.indexOf('@endphp', nameEnd);
    return mask(start, end < 0 ? nameEnd : end + '@endphp'.length);
  }
  // `@verbatim … @endverbatim`: the content is output as is (often Vue templates) — keep it
  if (name === 'verbatim') {
    mask(start, nameEnd);
    const end = source.indexOf('@endverbatim', nameEnd);
    if (end < 0) {
      return nameEnd;
    }
    return mask(end, end + '@endverbatim'.length);
  }
  if (!hasArgs) {
    return mask(start, nameEnd);
  }
  const close = matchParen(source, j);
  return mask(start, close < 0 ? endOfLine(j) : close);
}

/** Index after the `)` matching the `(` at `open`, skipping PHP strings; -1 when unbalanced. */
export function matchParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') {
          i++;
        }
        i++;
      }
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

function applyMask(source: string, regions: Array<[number, number]>): string {
  if (regions.length === 0) {
    return source;
  }
  const parts: string[] = [];
  let last = 0;
  for (const [start, end] of regions) {
    parts.push(source.slice(last, start), source.slice(start, end).replace(/[^\r\n]/g, ' '));
    last = end;
  }
  parts.push(source.slice(last));
  return parts.join('');
}

/** Whether `offset` lies inside masked Blade code (strictly after its start). */
export function isInRegion(regions: Array<[number, number]>, offset: number): boolean {
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = regions[mid];
    if (offset <= start) {
      hi = mid - 1;
    } else if (offset > end) {
      lo = mid + 1;
    } else {
      // offset == end: right after `}}` / `)` — still Blade only for unterminated constructs
      return offset < end;
    }
  }
  return false;
}
