declare const __PKG_VERSION__: string;

/** Package version, injected at build time by tsup. */
export const VERSION = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "dev";
