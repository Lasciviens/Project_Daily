// Compile-time stamp for "Pick on page": every React component's root element
// gets `data-src="src/…/File.tsx#Name"`, so a pick can name the component and
// file it came from instead of describing boxes and coordinates. Runs in all
// builds (production minifies component names away, so the fiber walk the
// picker used before only ever worked in development).
//
// Pure and dependency-free: the TypeScript compiler API is passed in (the
// Vite plugin in vite.config.ts hands it `typescript`), so
// scripts/verify-dev-request-context.cjs can run the real transform.
//
// What gets stamped, per component (a Capitalised function, arrow function,
// or one wrapped in memo/forwardRef):
//   · each JSX element it returns (both branches of `a ? <A/> : <B/>`, the
//     right side of `cond && <A/>`), when it is a DOM element (`<div>`), or
//     one of this app's own components (imported from a relative path —
//     `<Card>`, `<ModalShell>`), which pass unknown props to their root;
//   · never fragments, member tags (`<Ctx.Provider>`, `<motion.div>`) or
//     library components (`<Dialog>`, `<ResponsiveContainer>`).
// The attribute goes FIRST in the list, so a `{...rest}` spread after it lets
// the caller's (more specific) stamp win: `<Card>` inside NutritionCard
// reports NutritionCard, not Card.

/** Only the parts of the `typescript` module the transform uses. */
type TS = typeof import('typescript')
type Node = import('typescript').Node
type SourceFile = import('typescript').SourceFile

export const SOURCE_ATTR = 'data-src'

export interface StampEdit { pos: number; text: string }

const isComponentName = (n: string | undefined): n is string => !!n && /^[A-Z][A-Za-z0-9_]*$/.test(n)

/** Names imported from a relative path in this file — the app's own components. */
function localImports(ts: TS, sf: SourceFile): Set<string> {
  const out = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    if (!st.moduleSpecifier.text.startsWith('.')) continue
    const clause = st.importClause
    if (!clause || clause.isTypeOnly) continue
    if (clause.name) out.add(clause.name.text)
    const nb = clause.namedBindings
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) out.add(el.name.text)
  }
  return out
}

/** The component name a function node defines, if any. */
function componentNameOf(ts: TS, fn: Node): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name && isComponentName(fn.name.text)) return fn.name.text
  // const X = () => …  /  const X = memo(() => …)  /  forwardRef(function (…) …)
  let p: Node | undefined = fn.parent
  while (p && ts.isCallExpression(p)) p = p.parent
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p))) p = p.parent
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && isComponentName(p.name.text)) return p.name.text
  return undefined
}

/** The JSX a returned expression can evaluate to. */
function returnedJsx(ts: TS, e: Node | undefined, out: Node[]) {
  if (!e) return
  if (ts.isParenthesizedExpression(e)) return returnedJsx(ts, e.expression, out)
  if (ts.isConditionalExpression(e)) { returnedJsx(ts, e.whenTrue, out); returnedJsx(ts, e.whenFalse, out); return }
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    returnedJsx(ts, e.right, out); return
  }
  if (ts.isJsxElement(e)) out.push(e.openingElement)
  else if (ts.isJsxSelfClosingElement(e)) out.push(e)
}

/** Return statements of `body` that belong to it, not to a nested function. */
function ownReturns(ts: TS, body: Node, out: Node[]) {
  const visit = (n: Node) => {
    if (ts.isFunctionLike(n)) return
    if (ts.isReturnStatement(n)) { if (n.expression) out.push(n.expression); return }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(body, visit)
}

/**
 * The edits that stamp one file: an attribute inserted right after each
 * stamped element's tag name. Positions are into `code`; apply from the end.
 */
export function planSourceStamps(ts: TS, code: string, file: string): StampEdit[] {
  if (!code.includes('<')) return []
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const local = localImports(ts, sf)
  const edits: StampEdit[] = []
  const seen = new Set<number>()

  const stamp = (opening: Node, name: string) => {
    if (!(ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening))) return
    const tag = opening.tagName
    if (!ts.isIdentifier(tag)) return // <Ctx.Provider>, <motion.div>, <svg:x>
    const t = tag.text
    const dom = /^[a-z]/.test(t)
    if (!dom && !local.has(t)) return
    if (opening.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(sf) === SOURCE_ATTR)) return
    // After `<Tag` — or after its type arguments, `<SegmentedControl<Period>`.
    const pos = opening.typeArguments ? code.indexOf('>', opening.typeArguments.end) + 1 : tag.getEnd()
    if (pos <= 0) return
    if (seen.has(pos)) return
    seen.add(pos)
    edits.push({ pos, text: ` ${SOURCE_ATTR}="${file}#${name}"` })
  }

  const visit = (n: Node) => {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
      const name = componentNameOf(ts, n)
      if (name && n.body) {
        const exprs: Node[] = []
        if (ts.isBlock(n.body)) ownReturns(ts, n.body, exprs)
        else exprs.push(n.body)
        const roots: Node[] = []
        for (const e of exprs) returnedJsx(ts, e, roots)
        for (const r of roots) stamp(r, name)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return edits.sort((a, b) => b.pos - a.pos)
}

/** Applies the stamps; returns null when nothing changed. */
export function stampComponentSources(ts: TS, code: string, file: string): string | null {
  const edits = planSourceStamps(ts, code, file)
  if (edits.length === 0) return null
  let out = code
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos)
  return out
}
