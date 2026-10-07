/**
 * Title → lowercase ASCII words for branch names (design §9, AL-082). Pure: no git, no I/O.
 */

/** Letters that Unicode decomposition (NFKD) does not reduce to ASCII but have a common spelling. */
const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
  ħ: 'h',
  ŧ: 't',
  ŋ: 'n',
};

/** Apostrophes are dropped rather than split on, so "Don't" gives `dont`, not `don-t`. */
const APOSTROPHES = /['`‘’ʼ´]/g;
const COMBINING_MARKS = /\p{M}/gu;
const NON_ASCII = /[^\p{ASCII}]/gu;
const NON_ALPHANUMERIC = /[^a-z0-9]+/;

/**
 * Splits free text into lowercase ASCII words: accents are removed (`Café` → `cafe`), compatibility
 * forms are folded (full-width `ＡＢＣ` → `abc`, `ﬁ` → `fi`), a few letters are transliterated
 * (`ß` → `ss`), and everything else that is not `a–z` or `0–9` separates words. Letters with no
 * ASCII form (CJK, Cyrillic, emoji) separate words too, so a title made only of them gives `[]`.
 */
export function slugWords(text: string): string[] {
  const folded = text
    .replace(APOSTROPHES, '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(COMBINING_MARKS, '')
    .replace(NON_ASCII, (char) => TRANSLITERATIONS[char] ?? ' ');
  return folded.split(NON_ALPHANUMERIC).filter((word) => word.length > 0);
}

/**
 * `prefix-word-word…` with as many whole words as fit in `maxLength` once `suffix` is added.
 * When not even the first word fits, it is cut, so the name never ends up as the bare prefix.
 * The slug always keeps at least `minSlugLength` characters: a long prefix stretches the limit
 * rather than leaving no room for the words.
 */
export function composeName(
  prefix: string,
  words: readonly string[],
  options: { maxLength: number; minSlugLength: number; suffix?: string },
): string {
  const suffix = options.suffix ?? '';
  const limit =
    Math.max(options.maxLength, prefix.length + 1 + options.minSlugLength + suffix.length) - suffix.length;

  let name = prefix;
  for (const word of words) {
    const next = `${name}-${word}`;
    if (next.length <= limit) {
      name = next;
      continue;
    }
    if (name === prefix) {
      name = `${prefix}-${word.slice(0, limit - prefix.length - 1)}`;
    }
    break;
  }
  return name + suffix;
}
