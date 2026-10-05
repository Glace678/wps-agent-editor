// jsdom ships no bundled TypeScript declarations and @types/jsdom is not a
// project dependency (jsdom only enters the tree transitively). This test uses
// JSDOM purely as a DOM harness; an ambient shim keeps scripts/** typechecked
// without adding a dependency. Replace with @types/jsdom if it is ever adopted.
declare module 'jsdom'
