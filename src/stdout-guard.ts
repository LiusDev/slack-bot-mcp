// MCP over stdio owns stdout: any stray console.log corrupts the JSON-RPC
// stream. Route every console method that writes to stdout to stderr.
// Imported first by the entry point. Dependencies are external ESM imports and
// still evaluate before this module, but nothing logs at import time, so the
// swap is in place before any runtime logging.
const toStderr = (...args: unknown[]) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.trace = toStderr;
