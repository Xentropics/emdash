import { describe, expect, it } from 'vitest';
import { prefixCandidates, projectPrefixes } from './project-prefix';

describe('projectPrefixes', () => {
  it('derives codes from the name', () => {
    expect(prefixCandidates('emdash')[0]).toBe('EMD');
    expect(prefixCandidates('xentropics-omeka-markdown')[0]).toBe('XOM');
    expect(prefixCandidates('myProject')[0]).toBe('MYP');
    expect(prefixCandidates('ui')).toEqual(['UI']);
  });

  it('keeps codes unique, with older projects keeping theirs', () => {
    const codes = projectPrefixes([
      { id: 'a', name: 'emdash' },
      { id: 'b', name: 'emdash-local' },
      { id: 'c', name: 'Emdash' },
    ]);
    expect(codes.get('a')).toBe('EMD');
    expect(new Set(codes.values()).size).toBe(3);
    for (const code of codes.values()) expect(code).toHaveLength(3);
  });

  it('falls back to numbered codes when every letter pick is taken', () => {
    const codes = projectPrefixes([
      { id: 'a', name: 'abc' },
      { id: 'b', name: 'abc' },
      { id: 'c', name: 'abc' },
    ]);
    expect([...codes.values()]).toEqual(['ABC', 'AB2', 'AB3']);
  });
});
