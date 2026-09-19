/**
 * Typeset the plain-text mathematics in the question index.
 *
 * The index is hand-written and stores maths the way a teacher types it:
 * "evaluate 125^(2/3)", "5/6-2/3x3/8", "simplify root27+root12". This turns
 * those fragments into LaTeX so `MathText` can set them properly.
 *
 * Done at render time, not as a migration, for two reasons: the practice
 * search matches against the stored text, so a student typing "x^2" must
 * still find it; and the index stays the single readable source of truth
 * rather than a file of escaped backslashes.
 *
 * The whole design is built around *not* typesetting prose. A string is
 * split into whitespace tokens, each classified, and only a run that holds a
 * real mathematical signal is converted. Anything else is left exactly as the
 * teacher wrote it.
 */

/** Words that read as units, so a slash between them is "per", not a fraction. */
const UNITS = new Set([
  "m", "cm", "mm", "km", "g", "kg", "mg", "s", "h", "hr", "min", "l", "ml",
  "kmh", "mph", "rad", "deg",
]);

/** Function names that should be upright and spaced, not read as variables. */
const FUNCTIONS = ["sin", "cos", "tan", "sec", "cosec", "cot", "log", "ln"];

/** Words that belong to mathematics even though they are spelled out. */
const MATH_WORDS = new Set([...FUNCTIONS, "root", "pi"]);

/**
 * Short English words. Without these, "A=w^2 to x" swallows the "to" and
 * "fifth root of 7" turns into a square root of the word "of" — the word is
 * too short to be caught by the general prose rule, which needs three
 * letters so that single variables and pairs like "ab" stay available.
 */
const STOP_WORDS = new Set([
  "a", "an", "as", "at", "by", "do", "if", "in", "is", "it", "of", "on", "or",
  "so", "to", "up", "we", "be", "no", "per", "the", "and", "for", "its", "was",
  "are", "has", "can", "all", "any", "out", "use", "one", "two", "six", "ten",
]);

const ORDINAL = /^\d+(st|nd|rd|th)$/i;
const PURE_WORD = /^[A-Za-z]{3,}$/;

const isUnit = (s: string) => UNITS.has(s.toLowerCase());

/**
 * A slash is a fraction only when it divides quantities. "m/s", "km/h" and
 * "rupees/kg" are rates or units, and "max/min" is an English either-or —
 * none of them should turn into a stacked fraction on a revision card.
 */
function slashIsFraction(token: string): boolean {
  const m = /^([A-Za-z0-9.√()^+-]+)\/([A-Za-z0-9.√()^+-]+)$/.exec(token);
  if (!m) return /[0-9]\s*\/\s*[0-9]/.test(token);
  const [, a, b] = m;
  if (isUnit(a) && isUnit(b)) return false;
  const wordy = (x: string) => PURE_WORD.test(x) && !MATH_WORDS.has(x.toLowerCase());
  if (wordy(a) || wordy(b)) return false;
  return true;
}

/**
 * "5-2n" and "root125-root20" are expressions; "15-gon", "20-sided" and
 * "mark-up" are hyphenated words that merely contain a digit or a dash.
 */
function isHyphenatedExpression(token: string): boolean {
  const m = /^([A-Za-z0-9.]+)([+-])([A-Za-z0-9.]+)$/.exec(token);
  if (!m) return false;
  const [, a, , b] = m;
  if (PURE_WORD.test(a) || PURE_WORD.test(b)) return false;
  return /[0-9]/.test(token) && /[A-Za-z]/.test(token);
}

/** "f(x)", "g(2)", "gf(-1)" — a function applied to something. */
const FUNCTION_CALL = /^[A-Za-z]{1,3}\([^()]*\)$/;

type Kind = "strong" | "weak" | "prose";

/**
 * `strong` means "this is definitely mathematics" and can start a run.
 * `weak` can only join a run that a strong token already began.
 * `prose` always breaks a run.
 */
export function classify(raw: string): Kind {
  const t = raw.replace(/[,.;:]+$/, "");
  if (!t) return "weak";

  // Ordinals and percentages are how people write English, not algebra.
  if (ORDINAL.test(t)) return "prose";
  if (/^\d+(\.\d+)?%$/.test(t)) return "prose";
  // "3D", "2D" are descriptions of shape, not products.
  if (/^\d+[A-Za-z]$/.test(t) && /^\d+[DdSs]$/.test(t)) return "prose";

  if (/[√×÷=]/.test(t)) return "strong";
  if (/\^/.test(t)) return "strong";
  if (/^root\d/.test(t)) return "strong";
  if (t.includes("/") && slashIsFraction(t)) return "strong";
  if (FUNCTION_CALL.test(t) && /[0-9(]/.test(t)) return "strong";
  if (isHyphenatedExpression(t)) return "strong";
  if (/[<>]/.test(t) && /[A-Za-z0-9]/.test(t)) return "strong";

  if (MATH_WORDS.has(t.toLowerCase())) return "weak";
  if (STOP_WORDS.has(t.toLowerCase())) return "prose";
  if (PURE_WORD.test(t)) return "prose";
  // Short symbols, numbers, single letters, brackets and operators can all sit
  // inside an expression but never justify one on their own.
  if (/^[A-Za-z0-9.()[\]{}+\-*/:<>|'^_√]+$/.test(t)) return "weak";
  return "prose";
}

// ------------------------------------------------------------- expression --

const PH = "\u0001";
const phRef = (i: number) => `${PH}${i}${PH}`;

/** An atom is what a power or a fraction can attach to. */
const ATOM = `(?:${PH}\\d+${PH}|\\\\sqrt\\{[^{}]*\\}|[A-Za-z0-9.]+)`;

function convertPowers(s: string): string {
  // Exponent first, so the base of a fraction keeps its power attached.
  return s.replace(
    new RegExp(`\\^\\s*(${PH}\\d+${PH}|[+-]?[A-Za-z0-9.]+)`, "g"),
    (_, exp: string) => `^{${exp}}`,
  );
}

function convertFractions(s: string): string {
  const pattern = new RegExp(`(${ATOM}(?:\\^\\{[^{}]*\\})?)\\s*/\\s*(${ATOM}(?:\\^\\{[^{}]*\\})?)`, "g");
  let out = s;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(pattern, (_, a: string, b: string) => `\\frac{${a}}{${b}}`);
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Convert one run of mathematics to LaTeX.
 *
 * Bracketed groups are pulled out first and converted innermost-first, so a
 * fraction inside a power inside a bracket comes out right. Each group
 * remembers whether it still needs its brackets: as a power's exponent or a
 * fraction's argument the braces already do the grouping, and printing
 * "125^{(2/3)}" instead of "125^{2/3}" is the difference between looking
 * typeset and looking converted.
 */
export function toTex(input: string): string {
  const groups: string[] = [];

  let s = input;
  // Innermost brackets first.
  for (let guard = 0; guard < 12; guard++) {
    const next = s.replace(/\(([^()]*)\)/g, (_, inner: string) => {
      groups.push(inner);
      return phRef(groups.length - 1);
    });
    if (next === s) break;
    s = next;
  }

  const convert = (expr: string): string => {
    let e = expr;
    e = e.replace(/<=/g, " \\le ").replace(/>=/g, " \\ge ").replace(/!=/g, " \\ne ");
    e = e.replace(/×/g, " \\times ").replace(/÷/g, " \\div ");
    // "4x10^4" and "27x81^2" use a letter x where a printed paper uses a
    // multiplication sign. Only between digits — "5x^2" is a variable.
    e = e.replace(/(?<=\d)\s*[x*]\s*(?=\d)/g, " \\times ");
    e = e.replace(/(?<=\d)\s*\*\s*(?=[A-Za-z(])/g, " \\times ");
    // "root5", "root 5", "root x" and "√7" all mean a square root.
    e = e.replace(new RegExp(`√\\s*(${ATOM})`, "g"), (_, a: string) => `\\sqrt{${a}}`);
    e = e.replace(new RegExp(`\\broot\\s*(${ATOM})`, "g"), (_, a: string) => `\\sqrt{${a}}`);
    // "cm^2" is square centimetres, not c times m squared. Only multi-letter
    // units are safe to assume: a lone "m" is as likely to be a variable.
    e = e.replace(/\b(cm|mm|km|kg|mg|ml|kmh|mph)(?=\^)/g, "\\text{$1}");
    e = convertPowers(e);
    e = convertFractions(e);
    for (const f of FUNCTIONS) {
      e = e.replace(new RegExp(`\\b${f}\\b(?!\\{)`, "g"), `\\${f} `);
    }
    e = e.replace(/\bpi\b/g, "\\pi ");
    // An English word carried into an expression ("7^n=fifth root") must not
    // be set as a product of five italic variables. Anything preceded by a
    // backslash is a LaTeX command, not a word.
    e = e.replace(/(?<!\\)\b[A-Za-z]{4,}\b/g, (w) =>
      FUNCTIONS.includes(w) || UNITS.has(w) ? w : `\\text{${w}}`,
    );
    e = e.replace(/%/g, "\\%");
    e = e.replace(/\$/g, "\\$");
    return e;
  };

  s = convert(s);

  // Put the brackets back, innermost-first, deciding each time whether the
  // brackets are still doing work.
  for (let guard = 0; guard < 12; guard++) {
    const before = s;
    s = s.replace(new RegExp(`(\\^\\{|\\\\frac\\{|\\{)?${PH}(\\d+)${PH}`, "g"), (whole, prefix: string | undefined, idx: string) => {
      const inner = convert(groups[Number(idx)] ?? "");
      // Directly inside {...} the braces group it already; anywhere else the
      // brackets are part of the mathematics and must stay.
      if (prefix) return `${prefix}${inner}`;
      return `\\left(${inner}\\right)`;
    });
    if (s === before) break;
  }

  return s.replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------ public --

/**
 * Wrap the mathematical runs of a plain-text description in \( \) so that
 * `MathText` will typeset them. Prose is returned untouched.
 */
/**
 * The same handful of descriptions are re-converted on every keystroke as the
 * practice list re-filters, so the result is cached by input string.
 */
const cache = new Map<string, string>();

export function mathify(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const result = convertText(text);
  // The index is a fixed size, so this can never grow without bound.
  if (cache.size < 4000) cache.set(text, result);
  return result;
}

function convertText(text: string): string {
  if (!text) return text;
  // Already LaTeX (feedback from the marker, say) — leave it alone.
  if (/\\\(|\\\[/.test(text)) return text;

  // Alternating word / whitespace pieces, so the original spacing can be
  // reproduced exactly for anything left as prose.
  const pieces = text.split(/(\s+)/);
  const isSpace = pieces.map((p) => /^\s+$/.test(p));
  const kinds = pieces.map((p, i) => (isSpace[i] ? "weak" : classify(p)));

  const out: string[] = [];
  let i = 0;

  while (i < pieces.length) {
    if (kinds[i] === "prose") {
      out.push(pieces[i]);
      i++;
      continue;
    }

    // Take the maximal stretch that prose does not interrupt.
    let end = i;
    while (end < pieces.length && kinds[end] !== "prose") end++;

    // Narrow it to the first and last genuine piece of mathematics. A run
    // has to be anchored on a strong token; the weak tokens around it are
    // only along for the ride, and anything outside is ordinary text.
    let first = i;
    while (first < end && kinds[first] !== "strong") first++;

    if (first === end) {
      // Nothing in this stretch was mathematics after all.
      out.push(pieces.slice(i, end).join(""));
      i = end;
      continue;
    }

    let last = end - 1;
    while (last > first && kinds[last] !== "strong") last--;
    // Weak tokens between two strong ones stay; weak tokens on the outside
    // are prose. Extend outwards over non-space weak tokens only, so a
    // trailing space never ends up inside the delimiters.
    let from = first;
    while (from - 1 >= i && !isSpace[from - 1] && kinds[from - 1] === "weak") from--;
    let to = last;
    while (to + 1 < end && !isSpace[to + 1] && kinds[to + 1] === "weak") to++;
    // ...and across a space as well, so "tan x = -1/root3" keeps its "tan x"
    // instead of leaving the function stranded in the prose.
    while (from - 2 >= i && isSpace[from - 1] && kinds[from - 2] === "weak" && !isSpace[from - 2]) {
      from -= 2;
    }
    // Weak words that sit between strong tokens (the "ab sin C" of
    // "1/2 ab sin C") are already inside [from, to] because they lie between
    // two strong tokens; widen once more across spaces to pick up a trailing
    // run of weak words that follows the last strong token in the same breath.
    while (to + 2 < end && isSpace[to + 1] && kinds[to + 2] === "weak" && !isSpace[to + 2]) {
      to += 2;
    }

    if (from > i) out.push(pieces.slice(i, from).join(""));

    const body = pieces.slice(from, to + 1).join("");
    // Sentence punctuation belongs outside the mathematics.
    const m = /^([\s\S]*?)([,.;:]*)$/.exec(body)!;
    const tex = toTex(m[1]);
    out.push(tex ? `\\(${tex}\\)${m[2]}` : body);

    if (to + 1 < end) out.push(pieces.slice(to + 1, end).join(""));
    i = end;
  }

  return out.join("");
}
