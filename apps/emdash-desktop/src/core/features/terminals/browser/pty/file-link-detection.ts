import type { ILink } from '@xterm/xterm';

// A path segment character: any letter, digit or mark (so `Curaçao` and decomposed
// macOS names match), `_ - . @ +`, or a backslash-escaped space (`My\ Folder`).
const SEGMENT_CHAR = String.raw`(?:[\p{L}\p{N}\p{M}_\-.@+]|\\ )`;
// Lookbehind on `:` keeps URLs (`https://...`) with WebLinksAddon.
const UNQUOTED_PATH = String.raw`(?<![\p{L}\p{N}\p{M}_\-./@:\\])(?:~/|/|\.{1,2}/)?(?:${SEGMENT_CHAR}+/)*${SEGMENT_CHAR}*`;
// A quoted spelling may contain plain spaces; the quotes are not part of the link.
const QUOTED_PATH = String.raw`(["'\x60])([^"'\x60\n]+)\1`;
const LINE_SUFFIX = String.raw`(?::(\d+)(?::(\d+))?)?`;
const FILE_PATH_PATTERN = String.raw`${QUOTED_PATH}|(${UNQUOTED_PATH})${LINE_SUFFIX}`;
const EXTENSION = /\.[a-zA-Z][a-zA-Z0-9]{0,9}$/;
const TRAILING_PUNCTUATION = /[.,]+$/;
const COMBINING_MARK = /\p{M}/u;
const URL_PROTOCOL_PATTERN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const MAX_WRAPPED_LINE_LENGTH = 4096;

export type BufferLineLike = {
  isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
};

export type BufferLike = {
  getLine(index: number): BufferLineLike | undefined;
};

export type FileLinkMatch = {
  range: ILink['range'];
  /** The path to open, without quotes, escapes or a `:line` suffix. */
  text: string;
  /** Absolute, home-relative and folder paths are handed to the OS. */
  isExternal: boolean;
  /** From a `path:line` or `path:line:column` suffix. */
  line?: number;
};

type LogicalLine = {
  startBufferIndex: number;
  lineTexts: string[];
  lineStartColumns: number[];
  text: string;
};

type PathCandidate = {
  start: number;
  end: number;
  path: string;
  line?: number;
};

export function findFileLinks(buffer: BufferLike, bufferLineNumber: number): FileLinkMatch[] {
  const logicalLine = getWrappedLogicalLine(buffer, bufferLineNumber - 1);
  if (!logicalLine || !/[./]/.test(logicalLine.text)) {
    return [];
  }

  const links: FileLinkMatch[] = [];
  for (const candidate of findPathCandidates(logicalLine.text)) {
    const { start: startOffset, end: endOffset, path } = candidate;
    const range = mapOffsetRangeToBufferRange(logicalLine, startOffset, endOffset);
    if (!range) continue;

    const visibleRanges = mapOffsetRangeToVisibleBufferRanges(logicalLine, startOffset, endOffset);
    const linkRanges = shouldUseVisibleRanges(visibleRanges) ? visibleRanges : [range];
    for (const linkRange of linkRanges) {
      if (!rangeContainsBufferLine(linkRange, bufferLineNumber)) continue;
      links.push({
        range: linkRange,
        text: path,
        isExternal: path.startsWith('~/') || path.startsWith('/') || path.endsWith('/'),
        ...(candidate.line !== undefined && { line: candidate.line }),
      });
    }
  }
  return links;
}

function findPathCandidates(text: string): PathCandidate[] {
  const candidates: PathCandidate[] = [];
  // Fresh regex per call — module-level /g state isn't safe across reentrancy.
  const regex = new RegExp(FILE_PATH_PATTERN, 'gu');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    if (match[2] !== undefined) {
      const inner = match[2];
      if (isQuotedPath(inner) && !isEmbeddedInUrl(text, match.index)) {
        const start = match.index + 1;
        candidates.push({ start, end: start + inner.length, path: inner });
      } else {
        // Not a path: look for an unquoted one inside the quotes instead.
        regex.lastIndex = match.index + 1;
      }
      continue;
    }

    const raw = match[3] ?? '';
    const spelled = raw.replace(TRAILING_PUNCTUATION, '');
    const hasLineSuffix = match[4] !== undefined && spelled === raw;
    if (!isUnquotedPath(spelled) || isEmbeddedInUrl(text, match.index)) continue;
    const end = match.index + (hasLineSuffix ? match[0].length : spelled.length);
    candidates.push({
      start: match.index,
      end,
      path: spelled.replace(/\\ /g, ' '),
      ...(hasLineSuffix && { line: Number(match[4]) }),
    });
  }
  return candidates;
}

function isUnquotedPath(path: string): boolean {
  if (path.endsWith('/')) return /[^./~]/.test(path);
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  if (EXTENSION.test(lastSegment)) {
    // A bare name needs a stem of two or more characters, so `e.g` and `i.e` stay text.
    if (path.includes('/')) return true;
    return lastSegment.replace(EXTENSION, '').length >= 2;
  }
  // Absolute paths without an extension (`/usr/local/bin`, `~/Projects/site`).
  return /^(?:~|)\/[^/]+\/[^/]/.test(path);
}

function isQuotedPath(inner: string): boolean {
  if (inner.trim() !== inner || !inner.includes(' ')) return false;
  return /^(?:~\/|\/|\.{1,2}\/)/.test(inner) || (inner.includes('/') && EXTENSION.test(inner));
}

function isEmbeddedInUrl(text: string, startCol: number): boolean {
  const prefix = text.slice(0, startCol);
  const tokenStart = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\t'), -1) + 1;
  return URL_PROTOCOL_PATTERN.test(prefix.slice(tokenStart));
}

function getWrappedLogicalLine(buffer: BufferLike, bufferIndex: number): LogicalLine | null {
  const line = buffer.getLine(bufferIndex);
  if (!line) return null;

  let startBufferIndex = bufferIndex;
  while (startBufferIndex > 0 && buffer.getLine(startBufferIndex)?.isWrapped) {
    startBufferIndex -= 1;
  }

  const lineTexts: string[] = [];
  const lineStartColumns: number[] = [];
  let currentIndex = startBufferIndex;
  let totalLength = 0;
  while (true) {
    const currentLine = buffer.getLine(currentIndex);
    if (!currentLine) break;

    const text = currentLine.translateToString(true);
    lineTexts.push(text);
    lineStartColumns.push(0);
    totalLength += text.length;
    if (totalLength > MAX_WRAPPED_LINE_LENGTH) return null;

    const nextLine = buffer.getLine(currentIndex + 1);
    if (!nextLine?.isWrapped) break;
    currentIndex += 1;
  }

  return expandHardLineBreakPathContinuations(buffer, {
    startBufferIndex,
    lineTexts,
    lineStartColumns,
    text: lineTexts.join(''),
  });
}

function expandHardLineBreakPathContinuations(
  buffer: BufferLike,
  logicalLine: LogicalLine
): LogicalLine {
  let expanded = logicalLine;
  const firstLine = expanded.lineTexts[0];
  const previousBufferLine = buffer.getLine(expanded.startBufferIndex - 1);
  const previousLine = previousBufferLine?.isWrapped
    ? undefined
    : previousBufferLine?.translateToString(true);
  if (
    firstLine !== undefined &&
    previousLine !== undefined &&
    endsWithPathContinuation(previousLine) &&
    startsWithPathContinuation(firstLine)
  ) {
    expanded = {
      startBufferIndex: expanded.startBufferIndex - 1,
      lineTexts: [
        previousLine,
        trimPathContinuationStart(firstLine),
        ...expanded.lineTexts.slice(1),
      ],
      lineStartColumns: [
        0,
        countLeadingWhitespace(firstLine),
        ...expanded.lineStartColumns.slice(1),
      ],
      text: '',
    };
    expanded.text = expanded.lineTexts.join('');
  }

  const lastLineIndex = expanded.startBufferIndex + expanded.lineTexts.length - 1;
  const nextLine = buffer.getLine(lastLineIndex + 1)?.translateToString(true);
  if (
    nextLine !== undefined &&
    endsWithPathContinuation(expanded.text) &&
    startsWithPathContinuation(nextLine)
  ) {
    const trimmedNextLine = trimPathContinuationStart(nextLine);
    expanded = {
      startBufferIndex: expanded.startBufferIndex,
      lineTexts: [...expanded.lineTexts, trimmedNextLine],
      lineStartColumns: [...expanded.lineStartColumns, countLeadingWhitespace(nextLine)],
      text: expanded.text + trimmedNextLine,
    };
  }

  return expanded.text.length > MAX_WRAPPED_LINE_LENGTH ? logicalLine : expanded;
}

function endsWithPathContinuation(text: string): boolean {
  const fragment = trailingToken(text);
  return fragment.includes('/') && !isEmbeddedInUrl(text, text.length - fragment.length);
}

function startsWithPathContinuation(text: string): boolean {
  const trimmed = trimPathContinuationStart(text);
  return /^[\p{L}\p{N}\p{M}_.\-@+]+(?:\/|[\p{L}\p{N}\p{M}_.\-@+]*\.[a-zA-Z][a-zA-Z0-9]{0,9}\b)/u.test(
    trimmed
  );
}

function trimPathContinuationStart(text: string): string {
  return text.slice(countLeadingWhitespace(text));
}

function countLeadingWhitespace(text: string): number {
  return text.length - text.trimStart().length;
}

function trailingToken(text: string): string {
  const match = /[^\s([{"'`<]+$/.exec(text);
  return match?.[0] ?? '';
}

function mapOffsetRangeToBufferRange(
  logicalLine: LogicalLine,
  startOffset: number,
  endOffset: number
): ILink['range'] | null {
  const start = mapOffsetToBufferPosition(logicalLine, startOffset);
  const end = mapOffsetToBufferPosition(logicalLine, endOffset - 1);
  if (!start || !end) return null;
  // A trailing combining mark shares its base character's cell.
  if (COMBINING_MARK.test(logicalLine.text[endOffset - 1] ?? '')) end.x -= 1;
  return { start, end };
}

function mapOffsetRangeToVisibleBufferRanges(
  logicalLine: LogicalLine,
  startOffset: number,
  endOffset: number
): ILink['range'][] {
  const ranges: ILink['range'][] = [];
  let lineStartOffset = 0;
  for (let lineIndex = 0; lineIndex < logicalLine.lineTexts.length; lineIndex += 1) {
    const lineLength = logicalLine.lineTexts[lineIndex]?.length ?? 0;
    const lineEndOffset = lineStartOffset + lineLength;
    const segmentStartOffset = Math.max(startOffset, lineStartOffset);
    const segmentEndOffset = Math.min(endOffset, lineEndOffset);
    if (segmentStartOffset < segmentEndOffset) {
      const lineText = logicalLine.lineTexts[lineIndex] ?? '';
      const xOffset = logicalLine.lineStartColumns[lineIndex] ?? 0;
      const y = logicalLine.startBufferIndex + lineIndex + 1;
      ranges.push({
        start: {
          x: xOffset + cellWidth(lineText.slice(0, segmentStartOffset - lineStartOffset)) + 1,
          y,
        },
        end: {
          x: xOffset + cellWidth(lineText.slice(0, segmentEndOffset - lineStartOffset)),
          y,
        },
      });
    }
    lineStartOffset = lineEndOffset;
  }
  return ranges;
}

function shouldUseVisibleRanges(ranges: ILink['range'][]): boolean {
  return ranges.some((range, index) => index > 0 && range.start.x > 1);
}

function rangeContainsBufferLine(range: ILink['range'], bufferLineNumber: number): boolean {
  return range.start.y <= bufferLineNumber && range.end.y >= bufferLineNumber;
}

function mapOffsetToBufferPosition(
  logicalLine: LogicalLine,
  offset: number
): ILink['range']['start'] | null {
  let remaining = offset;
  for (let lineIndex = 0; lineIndex < logicalLine.lineTexts.length; lineIndex += 1) {
    const lineLength = logicalLine.lineTexts[lineIndex]?.length ?? 0;
    if (remaining < lineLength) {
      return {
        x:
          (logicalLine.lineStartColumns[lineIndex] ?? 0) +
          cellWidth(logicalLine.lineTexts[lineIndex]?.slice(0, remaining) ?? '') +
          1,
        y: logicalLine.startBufferIndex + lineIndex + 1,
      };
    }
    remaining -= lineLength;
  }
  return null;
}

/**
 * Terminal cells taken by `text`: xterm draws a combining mark (as in decomposed
 * macOS file names) in its base character's cell.
 */
function cellWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (!COMBINING_MARK.test(char)) width += char.length;
  }
  return width;
}
