/**
 * Characters that must never reach a report, a terminal or the page as plain
 * text: C0 controls and DEL, C1 controls, line and paragraph separators,
 * zero-width space and the byte-order mark, and the text-direction overrides,
 * embeddings and isolates that can reorder or disguise a line.
 *
 * U+200C and U+200D (zero-width non-joiner and joiner) are allowed: Persian and
 * several other scripts, and emoji sequences, need them.
 */
export function isUnsafeCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x200b ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

export function hasUnsafeCharacter(text: string): boolean {
  for (const character of text) {
    if (isUnsafeCharacter(character.codePointAt(0) ?? 0)) return true;
  }
  return false;
}
