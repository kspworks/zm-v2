/**
 * Keyboard-layout-agnostic search: text typed with the wrong layout active is
 * also tried as the characters on the same *physical keys* in the other
 * layout, so "ghj" (EN) finds "про" (UK) and vice versa. The mapping strings
 * are ported from v1's makeKeyboardLayouts.
 */
const EN_LAYOUT = `QWERTYUIOP{}ASDFGHJKL:"|ZXCVBNM<>?qwertyuiop[]asdfghjkl;'\\zxcvbnm,./`;
const UK_LAYOUT =
  "ЙЦУКЕНГШЩЗХЇФІВАПРОЛДЖЄ₴ЯЧСМИТЬБЮ,йцукенгшщзхїфівапролджєʼячсмитьбю.";

const zipMap = (from: string[], to: string[]) =>
  new Map(from.map((char, index) => [char, to[index] ?? char]));

const EN_CHARS = [...EN_LAYOUT];
const UK_CHARS = [...UK_LAYOUT];
const EN_TO_UK = zipMap(EN_CHARS, UK_CHARS);
const UK_TO_EN = zipMap(UK_CHARS, EN_CHARS);

const translate = (text: string, map: Map<string, string>) =>
  [...text].map((char) => map.get(char) ?? char).join("");

/** The query as typed, plus its EN→UK and UK→EN physical-key variants */
export const layoutVariants = (query: string): string[] => [
  ...new Set([query, translate(query, EN_TO_UK), translate(query, UK_TO_EN)]),
];

/** Case-insensitive substring match of any layout variant */
export const matchesAnyLayout = (label: string, query: string): boolean => {
  const needle = query.trim();

  if (!needle) {
    return true;
  }

  const haystack = label.toLocaleLowerCase();

  return layoutVariants(needle).some((variant) =>
    haystack.includes(variant.toLocaleLowerCase()),
  );
};
