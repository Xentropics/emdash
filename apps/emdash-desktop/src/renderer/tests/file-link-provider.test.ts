import type { ILink } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import {
  ActivationModifierTracker,
  FileLinkProvider,
  isActivationModifierPressed,
  isPrimaryMouseButton,
} from '@core/features/terminals/api/browser/pty/file-link-provider';
import { findFileLinks } from '@core/features/terminals/browser/pty/file-link-detection';

class MockBufferLine {
  constructor(
    private readonly text: string,
    readonly isWrapped = false
  ) {}

  translateToString(): string {
    return this.text;
  }
}

function makeBuffer(lines: MockBufferLine[]) {
  return {
    getLine(index: number): MockBufferLine | undefined {
      return lines[index];
    },
  };
}

describe('file link provider', () => {
  it('detects one path across wrapped terminal lines', () => {
    const buffer = makeBuffer([
      new MockBufferLine('error in src/renderer/lib/pty/file-link-'),
      new MockBufferLine('provider.ts', true),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 10, y: 1 },
          end: { x: 11, y: 2 },
        },
        text: 'src/renderer/lib/pty/file-link-provider.ts',
        isExternal: false,
      },
    ]);
    expect(findFileLinks(buffer, 2)[0]?.text).toBe('src/renderer/lib/pty/file-link-provider.ts');
  });

  it('detects one path split by adjacent hard line breaks', () => {
    const buffer = makeBuffer([
      new MockBufferLine(
        '  Local agents do not use the terminal shell resolver at all. In src/main/core/'
      ),
      new MockBufferLine(
        '  conversations/impl/local-conversation.ts:140, agent sessions call resolveLocalPtySpawn'
      ),
    ]);

    const expectedFirstLineLink = {
      range: {
        start: { x: 66, y: 1 },
        end: { x: 79, y: 1 },
      },
      text: 'src/main/core/conversations/impl/local-conversation.ts',
      isExternal: false,
      line: 140,
    };
    const expectedSecondLineLink = {
      range: {
        start: { x: 3, y: 2 },
        end: { x: 46, y: 2 },
      },
      text: 'src/main/core/conversations/impl/local-conversation.ts',
      isExternal: false,
      line: 140,
    };
    expect(findFileLinks(buffer, 1)).toEqual([expectedFirstLineLink]);
    expect(findFileLinks(buffer, 2)).toEqual([expectedSecondLineLink]);
  });

  it('does not join unrelated hard line breaks', () => {
    const buffer = makeBuffer([
      new MockBufferLine('  See src/main/core/'),
      new MockBufferLine('  for more implementation details.'),
    ]);

    // The folder on its own is a link; it is not joined with the prose below.
    expect(findFileLinks(buffer, 1).map((link) => link.text)).toEqual(['src/main/core/']);
    expect(findFileLinks(buffer, 2)).toEqual([]);
  });

  it('does not join backward from the middle of a wrapped line chain', () => {
    const buffer = makeBuffer([
      new MockBufferLine('src/foo/'),
      new MockBufferLine('bar/', true),
      new MockBufferLine('  baz.ts'),
    ]);

    expect(findFileLinks(buffer, 3).map((link) => link.text)).toEqual(['baz.ts']);
  });

  it('classifies absolute and home-relative paths as external', () => {
    const buffer = makeBuffer([
      new MockBufferLine('open /tmp/output/report.md and ~/notes/todo.md'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 6, y: 1 },
          end: { x: 26, y: 1 },
        },
        text: '/tmp/output/report.md',
        isExternal: true,
      },
      {
        range: {
          start: { x: 32, y: 1 },
          end: { x: 46, y: 1 },
        },
        text: '~/notes/todo.md',
        isExternal: true,
      },
    ]);
  });

  it('keeps URL paths delegated to the web links addon', () => {
    const buffer = makeBuffer([new MockBufferLine('see https://example.com/src/file.ts')]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('matches paths with non-ASCII letters, including decomposed ones', () => {
    const composed = 'see Prospects/Curaçao/concept.md';
    const decomposed = 'see Prospects/Curac\u0327ao/concept.md';

    expect(findFileLinks(makeBuffer([new MockBufferLine(composed)]), 1)).toEqual([
      {
        range: { start: { x: 5, y: 1 }, end: { x: 32, y: 1 } },
        text: 'Prospects/Curaçao/concept.md',
        isExternal: false,
      },
    ]);
    // The combining cedilla shares the `c` cell, so the range stays the same width.
    expect(findFileLinks(makeBuffer([new MockBufferLine(decomposed)]), 1)).toEqual([
      {
        range: { start: { x: 5, y: 1 }, end: { x: 32, y: 1 } },
        text: 'Prospects/Curac\u0327ao/concept.md',
        isExternal: false,
      },
    ]);
  });

  it('keeps a line suffix in the link and reports the line', () => {
    const buffer = makeBuffer([new MockBufferLine('at src/foo/bar.ts:42:7, then README.md:3.')]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: { start: { x: 4, y: 1 }, end: { x: 22, y: 1 } },
        text: 'src/foo/bar.ts',
        isExternal: false,
        line: 42,
      },
      {
        range: { start: { x: 30, y: 1 }, end: { x: 40, y: 1 } },
        text: 'README.md',
        isExternal: false,
        line: 3,
      },
    ]);
  });

  it('matches quoted paths and escaped spaces', () => {
    const buffer = makeBuffer([
      new MockBufferLine(
        'log "~/Library/Application Support/emdash/emdash.log" or ~/My\\ Notes/todo.md'
      ),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: { start: { x: 6, y: 1 }, end: { x: 52, y: 1 } },
        text: '~/Library/Application Support/emdash/emdash.log',
        isExternal: true,
      },
      {
        range: { start: { x: 58, y: 1 }, end: { x: 76, y: 1 } },
        text: '~/My Notes/todo.md',
        isExternal: true,
      },
    ]);
  });

  it('matches bare file names, folders and absolute paths without an extension', () => {
    const buffer = makeBuffer([
      new MockBufferLine('edit package.json in emdash-local/ or /usr/local/bin, e.g. not this.'),
    ]);

    expect(findFileLinks(buffer, 1).map(({ text, isExternal }) => ({ text, isExternal }))).toEqual([
      { text: 'package.json', isExternal: false },
      { text: 'emdash-local/', isExternal: true },
      { text: '/usr/local/bin', isExternal: true },
    ]);
  });

  it('leaves quoted prose and single words alone', () => {
    const buffer = makeBuffer([
      new MockBufferLine("it's 'not a path' and don't touch src/a.ts or v1.2.13 or and/or"),
    ]);

    expect(findFileLinks(buffer, 1).map((link) => link.text)).toEqual(['src/a.ts']);
  });

  it('requires Command on macOS and Control elsewhere', () => {
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(isActivationModifierPressed({ metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: false }, false)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: true }, true)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: true }, false)).toBe(false);
  });

  it('only treats the primary mouse button as link activation', () => {
    expect(isPrimaryMouseButton({ button: 0 })).toBe(true);
    expect(isPrimaryMouseButton({ button: 1 })).toBe(false);
    expect(isPrimaryMouseButton({ button: 2 })).toBe(false);
  });

  it('clears initial underline decorations from mouse events without the modifier', () => {
    const tracker = new ActivationModifierTracker(true);

    expect(tracker.update({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(tracker.decorations()).toEqual({ pointerCursor: true, underline: true });

    expect(tracker.update({ metaKey: false, ctrlKey: false })).toBe(false);
    expect(tracker.decorations()).toEqual({ pointerCursor: false, underline: false });
  });

  it('updates hovered decorations when the modifier changes without mouse movement', () => {
    const tracker = new ActivationModifierTracker(true);
    const decorations = tracker.decorations();

    tracker.hover(decorations, { metaKey: true, ctrlKey: false });
    expect(decorations).toEqual({ pointerCursor: true, underline: true });

    tracker.update({ metaKey: false, ctrlKey: false });
    expect(decorations).toEqual({ pointerCursor: false, underline: false });
  });

  it('only opens links when the activation modifier is pressed', () => {
    const openedFiles: [string, number | undefined][] = [];
    const openedExternal: string[] = [];
    const buffer = makeBuffer([new MockBufferLine('open ./src/app.ts:12 and /tmp/report.md')]);
    const provider = new FileLinkProvider(
      { buffer: { active: buffer } } as never,
      (filePath, line) => openedFiles.push([filePath, line]),
      (filePath) => openedExternal.push(filePath),
      new ActivationModifierTracker(true)
    );

    let links: ILink[] = [];
    provider.provideLinks(1, (providedLinks) => {
      links = providedLinks ?? [];
    });

    const relativeLink = links[0]!;
    relativeLink.activate(
      { button: 0, metaKey: false, ctrlKey: false } as MouseEvent,
      relativeLink.text
    );
    relativeLink.activate(
      { button: 2, metaKey: true, ctrlKey: false } as MouseEvent,
      relativeLink.text
    );
    relativeLink.activate(
      { button: 0, metaKey: true, ctrlKey: false } as MouseEvent,
      relativeLink.text
    );

    const externalLink = links[1]!;
    externalLink.activate(
      { button: 0, metaKey: false, ctrlKey: false } as MouseEvent,
      externalLink.text
    );
    externalLink.activate(
      { button: 2, metaKey: true, ctrlKey: false } as MouseEvent,
      externalLink.text
    );
    externalLink.activate(
      { button: 0, metaKey: true, ctrlKey: false } as MouseEvent,
      externalLink.text
    );

    expect(openedFiles).toEqual([['src/app.ts', 12]]);
    expect(openedExternal).toEqual(['/tmp/report.md']);
  });
});
