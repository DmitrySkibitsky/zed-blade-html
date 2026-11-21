import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getLanguageService } from 'vscode-html-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isInRegion, maskBlade, matchParen } from '../src/blade.ts';

/** Asserts the invariant every masking must keep: same length, same line breaks. */
function mask(source: string): string {
  const { text } = maskBlade(source);
  assert.equal(text.length, source.length, 'masked text keeps the length');
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n' || source[i] === '\r') {
      assert.equal(text[i], source[i], `line break at ${i} is kept`);
    }
  }
  return text;
}

/** `fragment` (its `occurrence`-th match) is blanked out in the masked text. */
function assertMasked(source: string, fragment: string, occurrence = 0): void {
  const at = nth(source, fragment, occurrence);
  const masked = mask(source).slice(at, at + fragment.length);
  assert.equal(masked.trim(), '', `"${fragment}" should be masked, got "${masked}"`);
}

/** `fragment` survives masking unchanged. */
function assertKept(source: string, fragment: string, occurrence = 0): void {
  const at = nth(source, fragment, occurrence);
  assert.equal(mask(source).slice(at, at + fragment.length), fragment, `"${fragment}" should be kept`);
}

function nth(source: string, fragment: string, occurrence: number): number {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) {
    at = source.indexOf(fragment, at + 1);
    assert.ok(at >= 0, `fixture contains "${fragment}" #${i}`);
  }
  return at;
}

describe('echoes and comments', () => {
  test('{{ }} is masked, surrounding HTML kept', () => {
    const src = '<p class="title">{{ $user->name }}</p>';
    assertMasked(src, '{{ $user->name }}');
    assertKept(src, '<p class="title">');
    assertKept(src, '</p>');
  });

  test('{!! !!} is masked', () => {
    assertMasked('<div>{!! $html !!}</div>', '{!! $html !!}');
  });

  test('{{-- --}} comment is masked across lines, including tags inside', () => {
    const src = '<a>\n{{-- <div class="x">\n  @if($a) --}}\n</a>';
    assertMasked(src, '{{-- <div class="x">');
    assertMasked(src, '  @if($a) --}}');
    assertKept(src, '</a>');
  });

  test('echo containing ">" and "}" does not end early or open tags', () => {
    const src = '<input value="{{ $a > 1 ? json_encode([\'k\' => 1]) : \'\' }}" name="n">';
    assertMasked(src, "{{ $a > 1 ? json_encode(['k' => 1]) : '' }}");
    assertKept(src, 'name="n">');
  });

  test('echo inside an attribute value is masked, the attribute kept', () => {
    const src = '<input value="{{ old(\'email\') }}" type="email">';
    assertKept(src, '<input value="');
    assertMasked(src, "{{ old('email') }}");
    assertKept(src, '" type="email">');
  });

  test('echo as a whole attribute (component attribute bag)', () => {
    const src = "<div {{ $attributes->merge(['class' => 'a']) }} id=\"x\"></div>";
    assertMasked(src, "{{ $attributes->merge(['class' => 'a']) }}");
    assertKept(src, 'id="x"');
  });

  test('escaped @{{ }} (literal Vue interpolation) is masked', () => {
    assertMasked('<span>@{{ message }}</span>', '@{{ message }}');
  });

  test('unterminated echo while typing is masked only to the end of the line', () => {
    const src = '<p>{{ $user->na\n<div class="x"></div>';
    assertMasked(src, '{{ $user->na');
    assertKept(src, '<div class="x"></div>');
  });

  test('unterminated comment runs to the end of the document', () => {
    assertMasked('<p>\n{{-- todo\n<div></div>', '<div></div>');
  });
});

describe('directives', () => {
  test('control structures with arguments are masked, markup between kept', () => {
    const src = '@if ($job->id && count($items) > 0)\n  <br>\n@elseif($x)\n  <hr>\n@else\n  <p></p>\n@endif';
    assertMasked(src, '@if ($job->id && count($items) > 0)');
    assertMasked(src, '@elseif($x)');
    assertMasked(src, '@else');
    assertMasked(src, '@endif');
    assertKept(src, '<br>');
    assertKept(src, '<hr>');
    assertKept(src, '<p></p>');
  });

  test('nested parentheses and parentheses inside strings', () => {
    const src = "@include('partials.form (old)', ['a' => fn() => strlen(\")\")])<div></div>";
    assertMasked(src, "@include('partials.form (old)', ['a' => fn() => strlen(\")\")])");
    assertKept(src, '<div></div>');
  });

  test('argument list spanning lines', () => {
    const src = "@include('x', [\n    'a' => 1,\n    'b' => '<b>',\n])\n<span></span>";
    assertMasked(src, "'b' => '<b>',");
    assertMasked(src, '])');
    assertKept(src, '<span></span>');
  });

  test('directive without arguments and with whitespace before arguments', () => {
    const src = "<form>@csrf @method ('PUT')</form>";
    assertMasked(src, '@csrf');
    assertMasked(src, "@method ('PUT')");
    assertKept(src, '<form>');
    assertKept(src, '</form>');
  });

  test('unbalanced directive while typing is masked to the end of the line', () => {
    const src = '@if($a &&\n<div></div>';
    assertMasked(src, '@if($a &&');
    assertKept(src, '<div></div>');
  });

  test('custom (package) directives and namespaced ones', () => {
    const src = "@dp_global_can('job.edit')<a></a>@enddp_global_can @livewire::styles";
    assertMasked(src, "@dp_global_can('job.edit')");
    assertMasked(src, '@enddp_global_can');
    assertMasked(src, '@livewire::styles');
  });

  test('@@ escapes a directive (printed literally, not Blade)', () => {
    const src = '<code>@@if</code>';
    assertKept(src, '@@if');
  });

  test('e-mail addresses and decorators are not directives', () => {
    const src = '<a href="mailto:office@example.com">office@example.com</a>';
    assertKept(src, 'office@example.com', 0);
    assertKept(src, 'office@example.com', 1);
  });

  test('@section with inline content and @endsection', () => {
    const src = "@section('title', 'Jobs')\n@section('content')\n<main></main>\n@endsection";
    assertMasked(src, "@section('title', 'Jobs')");
    assertMasked(src, "@section('content')");
    assertMasked(src, '@endsection');
    assertKept(src, '<main></main>');
  });
});

describe('PHP code', () => {
  test('@php … @endphp block is masked including HTML-looking code and @var docblocks', () => {
    const src = '@php\n    /** @var \\App\\Job $job */\n    $html = "<div>";\n@endphp\n<p></p>';
    assertMasked(src, '/** @var \\App\\Job $job */');
    assertMasked(src, '$html = "<div>";');
    assertMasked(src, '@endphp');
    assertKept(src, '<p></p>');
  });

  test('inline @php(…) is masked like a directive', () => {
    const src = '@php($total = $a + 1)<b></b>';
    assertMasked(src, '@php($total = $a + 1)');
    assertKept(src, '<b></b>');
  });

  test('<?php ?> and <?= ?> are masked', () => {
    const src = '<?php echo "<i>"; ?><b></b><?= $x ?>';
    assertMasked(src, '<?php echo "<i>"; ?>');
    assertMasked(src, '<?= $x ?>');
    assertKept(src, '<b></b>');
  });

  test('@verbatim keeps its content (Vue templates) but masks the directives', () => {
    const src = '@verbatim\n<div>{{ vueValue }} @click</div>\n@endverbatim';
    assertMasked(src, '@verbatim');
    assertMasked(src, '@endverbatim');
    assertKept(src, '<div>');
  });
});

describe('Vue and other attributes inside tags', () => {
  test('Vue @event shorthand inside a start tag is kept', () => {
    const src =
      '<AudioRecordOneFile @on-file-loaded="onLoaded" @click.prevent="go" @update:model-value="v"></AudioRecordOneFile>';
    assertKept(src, '@on-file-loaded="onLoaded"');
    assertKept(src, '@click.prevent="go"');
    assertKept(src, '@update:model-value="v"');
  });

  test('Vue @event with spaces around = is kept', () => {
    assertKept('<button @click = "save">', '@click = "save"');
  });

  test('Blade attribute directives inside a start tag are masked', () => {
    const src = "<input type=\"checkbox\" @checked(old('a', $a)) @disabled($locked) @class(['p-4', 'b' => $b])>";
    assertMasked(src, "@checked(old('a', $a))");
    assertMasked(src, '@disabled($locked)');
    assertMasked(src, "@class(['p-4', 'b' => $b])");
    assertKept(src, 'type="checkbox"');
  });

  test('@if … @endif between attributes is masked, attributes kept', () => {
    const src = '<div @if($open) class="open" @endif data-id="1">';
    assertMasked(src, '@if($open)');
    assertMasked(src, '@endif');
    assertKept(src, 'class="open"');
    assertKept(src, 'data-id="1"');
  });

  test('directives inside an attribute value are masked', () => {
    const src = '<li class="item @if($active) active @endif">';
    assertMasked(src, '@if($active)');
    assertMasked(src, '@endif');
    assertKept(src, '<li class="item ');
  });

  test('@json in a Vue binding is masked, the binding name kept', () => {
    const src = '<UserCard :items=\'@json($items)\' :user-id="{{ $id }}"></UserCard>';
    assertKept(src, ":items='");
    assertMasked(src, '@json($items)');
    assertKept(src, ':user-id="');
    assertMasked(src, '{{ $id }}');
  });

  test('a Vue event name that is also a Blade directive name stays an attribute', () => {
    const src = '<img @error="fallback" @disabled($x)>';
    assertKept(src, '@error="fallback"');
    assertMasked(src, '@disabled($x)');
  });

  test('Blade components, slots, Livewire and Alpine attributes are plain markup', () => {
    const src =
      '<x-alert type="error" :message="$message" /><x-slot:title>T</x-slot><livewire:counter wire:model.live="n" x-on:click="o = !o" />';
    assertKept(src, '<x-alert type="error" :message="$message" />');
    assertKept(src, '<x-slot:title>T</x-slot>');
    assertKept(src, '<livewire:counter wire:model.live="n" x-on:click="o = !o" />');
  });

  test('outside of tags @word is a directive even when followed by "="', () => {
    assertMasked('<p>@lang("a")</p>', '@lang("a")');
  });
});

describe('raw text elements and HTML comments', () => {
  test('Blade inside <script> is masked; "<" in JS does not open a tag', () => {
    const src =
      '<script>\nconst ok = 1 < 2 && "@a";\nconst cfg = {!! json_encode($c) !!};\nconst v = {{ $v }};\n</script>\n<button @click="go"></button>';
    assertMasked(src, '{!! json_encode($c) !!}');
    assertMasked(src, '{{ $v }}');
    assertKept(src, 'const ok = 1 < 2');
    // after the script the tag tracking is back: the Vue event is an attribute again
    assertKept(src, '@click="go"');
  });

  test('CSS at-rules in <style> do not break the following markup', () => {
    const src = '<style>@media (max-width: 600px) { a { color: red } }</style><a @click="x"></a>';
    assertKept(src, '<a @click="x"></a>');
  });

  test('Blade inside an HTML comment is still masked (Blade compiles it)', () => {
    const src = '<!-- {{ $debug }} <div> -->\n<span @click="a"></span>';
    assertMasked(src, '{{ $debug }}');
    assertKept(src, '<span @click="a"></span>');
  });
});

describe('positions', () => {
  test('CRLF line endings are kept', () => {
    const src = '@if($a)\r\n<div>\r\n{{ $b\r\n}}</div>\r\n@endif';
    const text = mask(src);
    assert.equal(text.split('\r\n').length, src.split('\r\n').length);
  });

  test('a large real-world-like template keeps the invariant', () => {
    const block =
      '@foreach ($rows as $row)\n<tr @class(["odd" => $loop->odd]) data-id="{{ $row->id }}">\n  <td>{!! $row->html !!}</td>\n</tr>\n@endforeach\n';
    mask(block.repeat(2000));
  });

  test('masked HTML parses into the expected element tree', () => {
    const src =
      '@extends(\'layout\')\n@section(\'content\')\n<form method="POST">\n  @csrf\n  @if ($a > $b)\n    <input name="a" value="{{ $a }}">\n  @endif\n  <AudioRecordOneFile get-url="{{ route(\'x\') }}"></AudioRecordOneFile>\n</form>\n@endsection';
    const html = getLanguageService().parseHTMLDocument(TextDocument.create('file:///x.html', 'html', 1, mask(src)));
    const tags = (nodes: typeof html.roots): string[] => nodes.flatMap((n) => [n.tag ?? '', ...tags(n.children)]);
    assert.deepEqual(tags(html.roots), ['form', 'input', 'AudioRecordOneFile']);
  });
});

describe('isInRegion', () => {
  const src = '<p>{{ $a }}</p>';
  const { regions } = maskBlade(src);
  const start = src.indexOf('{{');
  const end = src.indexOf('}}') + 2;

  test('inside a region', () => {
    assert.equal(isInRegion(regions, start + 1), true);
    assert.equal(isInRegion(regions, end - 1), true);
  });

  test('region boundaries belong to the HTML around it', () => {
    assert.equal(isInRegion(regions, start), false);
    assert.equal(isInRegion(regions, end), false);
  });

  test('outside of all regions', () => {
    assert.equal(isInRegion(regions, 1), false);
    assert.equal(isInRegion(regions, src.length), false);
    assert.equal(isInRegion([], 5), false);
  });

  test('many regions (binary search)', () => {
    const many = maskBlade('<a>{{ $x }}</a>'.repeat(100)).regions;
    assert.equal(many.length, 100);
    assert.equal(isInRegion(many, 15 * 50 + 5), true);
    assert.equal(isInRegion(many, 15 * 50 + 1), false);
  });
});

describe('matchParen', () => {
  test('balanced, nested, quoted and escaped quotes', () => {
    assert.equal(matchParen('(a(b)c)', 0), 7);
    assert.equal(matchParen("(')')", 0), 5);
    assert.equal(matchParen('("\\")")x', 0), 7);
  });

  test('unbalanced returns -1', () => {
    assert.equal(matchParen('(a(b)', 0), -1);
  });
});
