/**
 * The avatar's letters.
 *
 * presby has no image upload and `people.photo_key` is a CONGREGATION's photo of
 * a person, not the platform user's avatar — different table, different
 * hierarchy, different privacy tier. So the avatar is initials, and this is the
 * whole of it.
 *
 * NOT `server-only` and no database import: the avatar menu is a client
 * component, and this has to be callable from it.
 */

/**
 * Up to two initials for a display name, falling back to the email.
 *
 * Rules, in order:
 *   1. A name with two or more words → first letter of the first word and of
 *      the last word ("Ada Lovelace" → "AL"). Middle names are dropped rather
 *      than crowding the circle.
 *   2. A single-word name → its first letter ("Ada" → "A").
 *   3. No usable name → the first letter of the email's local part.
 *   4. Neither → "?" rather than an empty circle, which reads as a rendering
 *      bug rather than as missing data.
 *
 * Non-letter leading characters are skipped, not rendered: an address like
 * `_ops@example.invalid` would otherwise show an underscore, and a name padded
 * with whitespace or punctuation would show the punctuation. Diacritics are
 * preserved — `Ólafur` is `Ó`, and stripping the accent would be a small insult
 * in a product whose whole job is getting people's names right.
 *
 * Uppercasing is `toLocaleUpperCase()` with NO locale argument, so it follows
 * the runtime's locale. This renders on the client, where that is the user's
 * own locale — which is the correct behavior for the Turkish dotless i.
 */
export function initialsFrom(
  name?: string | null,
  email?: string | null,
): string {
  const fromName = initialsFromName(name);
  if (fromName) return fromName;

  const fromEmail = firstLetter(email?.split("@")[0]);
  if (fromEmail) return fromEmail;

  return "?";
}

function initialsFromName(name?: string | null): string | null {
  const words = (name ?? "")
    .split(/\s+/)
    .map((word) => firstLetter(word))
    .filter((letter): letter is string => letter !== null);

  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return words[0] + words[words.length - 1];
}

/**
 * The first character of `value` that is a letter or a digit.
 *
 * `\p{L}` and `\p{N}` rather than `[A-Za-z0-9]`: a name in Greek, Cyrillic or
 * Hangul must produce its own initial, not fall through to the email.
 */
function firstLetter(value?: string | null): string | null {
  for (const char of value ?? "") {
    if (/[\p{L}\p{N}]/u.test(char)) return char.toLocaleUpperCase();
  }
  return null;
}

/**
 * What a screen reader and a `title` tooltip should call the account.
 *
 * The name when there is one, the email otherwise — never the initials, which
 * are a visual shorthand and read as nonsense letters aloud.
 */
export function accountLabel(
  name?: string | null,
  email?: string | null,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const trimmedEmail = email?.trim();
  if (trimmedEmail) return trimmedEmail;
  return "your account";
}
