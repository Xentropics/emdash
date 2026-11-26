/**
 * Short, unique codes for projects, shown before pinned tasks ("EMD: fix login").
 * Codes are 3 characters, derived from the name, and unique among the projects
 * given. Projects earlier in the list keep their code when later ones are added,
 * so pass them oldest first.
 */
export function projectPrefixes(
  projects: readonly { id: string; name: string }[]
): Map<string, string> {
  const taken = new Set<string>();
  const result = new Map<string, string>();
  for (const project of projects) {
    const code = firstFree(prefixCandidates(project.name), taken);
    taken.add(code);
    result.set(project.id, code);
  }
  return result;
}

const LENGTH = 3;

/** Candidate codes for a name, best first. */
export function prefixCandidates(name: string): string[] {
  const words = name
    // Split camelCase too: "myProject" -> "my Project".
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase());
  const letters = words.join('');
  if (letters.length === 0) return [];
  if (letters.length <= LENGTH) return [letters];

  const candidates: string[] = [];
  const [first = '', second = '', third = ''] = words;
  // Initials of the first three words: "emdash local build" -> "ELB".
  if (third) candidates.push(first[0]! + second[0]! + third[0]!);
  // Start of the first word: "emdash" -> "EMD".
  if (first.length >= LENGTH) candidates.push(first.slice(0, LENGTH));
  // Mixes of the first two words: "EML", "ELO".
  if (second) {
    candidates.push(first.slice(0, 2) + second[0]!);
    candidates.push(first[0]! + second.slice(0, 2));
  }
  // Every other pick of letters in name order, starting with the first letter.
  for (let i = 1; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      candidates.push(letters[0]! + letters[i]! + letters[j]!);
    }
  }
  return [...new Set(candidates.filter((c) => c.length === LENGTH))];
}

function firstFree(candidates: string[], taken: Set<string>): string {
  for (const c of candidates) if (!taken.has(c)) return c;
  // Every letter pick is taken: number the first two letters.
  const base = (candidates[0] ?? 'PRJ').slice(0, 2).padEnd(2, 'X');
  for (let n = 2; ; n++) {
    const code = n < 10 ? `${base}${n}` : `${base[0]}${n.toString(36).toUpperCase()}`;
    if (!taken.has(code)) return code;
  }
}
