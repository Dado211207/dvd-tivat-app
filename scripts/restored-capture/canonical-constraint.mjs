/**
 * Canonicalize a CHECK constraint definition so that forms differing only by
 * the associativity of a single boolean operator hash identically.
 *
 * Why this exists: a migration writes `x between a and b and p`, which the
 * parser stores as a nested 2-arg AND, `AND(AND(a,b), p)`. `pg_get_constraintdef`
 * prints that nested form, and production keeps it. But `pg_dump` emits that
 * text and restoring it re-parses to a FLATTENED 3-arg `AND(a, b, p)` - the
 * planner collapses adjacent same-operator AND/OR. So production (and a copy
 * built from the migrations) and a dump/restore copy describe the identical
 * constraint with different parentheses. Comparing the raw text would report a
 * difference that is not one.
 *
 * This flattens associative AND/OR so both converge. It is semantics-preserving
 * and deliberately narrow: it never reorders operands, never merges across
 * different operators (AND binds tighter than OR, as in SQL), and treats every
 * comparison, function call, cast and literal as an opaque atom it does not
 * look inside. A string literal's contents are never parsed. Anything that is
 * not a CHECK (a key, unique or exclusion constraint) is returned unchanged, so
 * those still compare exactly.
 *
 * It parses `pg_get_constraintdef` output, which fully parenthesizes operands,
 * so the grammar it must handle is small; an input it cannot parse cleanly is
 * returned unchanged rather than guessed at.
 */

const isWord = (c) => c !== undefined && /[A-Za-z0-9_$.]/.test(c);

/** Tokenize deparse output. Grouping parens are distinguished from call parens. */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\n' || c === '\t') { i += 1; continue; }
    if (c === "'") {
      let j = i + 1;
      let lit = "'";
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { lit += "''"; j += 2; continue; }
        if (text[j] === "'") { lit += "'"; j += 1; break; }
        lit += text[j]; j += 1;
      }
      tokens.push({ type: 'atom', text: lit });
      i = j;
      continue;
    }
    if (c === '(') {
      // A call/subscript paren immediately follows a word or a close; a
      // grouping paren follows whitespace, an operator, another '(', or start.
      const prev = tokens.length ? tokens[tokens.length - 1] : null;
      const glued = i > 0 && (isWord(text[i - 1]) || text[i - 1] === ')' || text[i - 1] === ']');
      if (glued && prev && (prev.type === 'atom' || prev.type === 'word')) { tokens.push({ type: 'call(', text: '(' }); }
      else tokens.push({ type: '(', text: '(' });
      i += 1;
      continue;
    }
    if (c === ')') { tokens.push({ type: ')', text: ')' }); i += 1; continue; }
    if (isWord(c)) {
      let j = i;
      while (j < text.length && isWord(text[j])) j += 1;
      const word = text.slice(i, j);
      const upper = word.toUpperCase();
      tokens.push({ type: upper === 'AND' || upper === 'OR' ? upper : 'word', text: word });
      i = j;
      continue;
    }
    // An operator run: anything else that is not a paren, space or quote.
    let j = i;
    while (j < text.length && !/[\sA-Za-z0-9_$'()]/.test(text[j])) j += 1;
    tokens.push({ type: 'atom', text: text.slice(i, j) });
    i = j;
  }
  return tokens;
}

class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }

  peek() { return this.t[this.i]; }

  // or := and ( OR and )*
  parseOr() {
    const parts = [this.parseAnd()];
    while (this.peek() && this.peek().type === 'OR') { this.i += 1; parts.push(this.parseAnd()); }
    return parts.length === 1 ? parts[0] : { op: 'OR', parts };
  }

  // and := primary ( AND primary )*
  parseAnd() {
    const parts = [this.parsePrimary()];
    while (this.peek() && this.peek().type === 'AND') { this.i += 1; parts.push(this.parsePrimary()); }
    return parts.length === 1 ? parts[0] : { op: 'AND', parts };
  }

  // primary := '(' or ')' | atom-run
  parsePrimary() {
    const tok = this.peek();
    if (!tok) throw new Error('unexpected end of constraint');
    if (tok.type === '(') {
      this.i += 1;
      const inner = this.parseOr();
      if (!this.peek() || this.peek().type !== ')') throw new Error('unbalanced grouping');
      this.i += 1;
      return inner;
    }
    // An atom run: consecutive tokens up to the next top-level boolean operator
    // or the end of this group, with call/subscript parens balanced inside.
    let text = '';
    let depth = 0;
    while (this.peek()) {
      const t = this.peek();
      if (depth === 0 && (t.type === 'AND' || t.type === 'OR' || t.type === ')')) break;
      if (t.type === '(' || t.type === 'call(') depth += 1;
      if (t.type === ')') depth -= 1;
      text += (text && t.type !== 'call(' && !text.endsWith('(') ? joinSpace(text, t) : '') + t.text;
      this.i += 1;
    }
    if (!text) throw new Error('empty atom');
    return { atom: text.trim() };
  }
}

/** A single space between tokens, except tight around call parens and casts. */
function joinSpace(sofar, tok) {
  if (tok.type === 'call(' || tok.type === ')') return '';
  if (tok.text === '::' || sofar.endsWith('::')) return '';
  return ' ';
}

function flatten(node) {
  if (node.atom !== undefined) return node;
  const parts = [];
  for (const part of node.parts) {
    const f = flatten(part);
    if (f.op === node.op) parts.push(...f.parts);
    else parts.push(f);
  }
  return { op: node.op, parts };
}

function emit(node) {
  if (node.atom !== undefined) return node.atom.replace(/\s+/g, ' ');
  return node.parts.map((p) => `(${emit(p)})`).join(` ${node.op} `);
}

/**
 * Returns a canonical string for a CHECK definition, or the input unchanged for
 * any other constraint kind or any input it cannot parse cleanly.
 */
export function canonicalizeConstraintDef(def) {
  if (typeof def !== 'string' || !def.startsWith('CHECK ')) return def;
  const body = def.slice('CHECK '.length).trim();
  try {
    const tokens = tokenize(body);
    const parser = new Parser(tokens);
    const tree = parser.parseOr();
    if (parser.i !== tokens.length) return def;
    return `CHECK (${emit(flatten(tree))})`;
  } catch {
    return def;
  }
}

/** Canonicalize a {name: def} map. */
export function canonicalizeConstraintDefs(defs) {
  const out = {};
  for (const [name, def] of Object.entries(defs ?? {})) out[name] = canonicalizeConstraintDef(def);
  return out;
}
