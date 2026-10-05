// Shared comment-stripping helper for source-level contract checks.
//
// Extracted verbatim from generate-command-contract.mjs and
// check-test-scripts-wired.mjs, which kept two byte-identical copies. The
// regexes are load-bearing: `[^:]` guard keeps `http://` URLs intact while
// still dropping `//` line comments. Do not change them without re-checking
// both call sites.
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
