import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

// Reuse the installed host's SDK; Git installs intentionally omit Pi dev dependencies.
const hostEntry = process.argv[2];
if (!hostEntry) throw new Error("Missing host Pi entry");
const sourceRoot = new URL("../", import.meta.url).href;
registerHooks({
  // Node's automatic type stripping rejects installed sources under node_modules.
  // This JavaScript bootstrap explicitly strips only this package's own sources.
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { sourceUrl: url }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@earendil-works/"))
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(hostEntry).href });
    return nextResolve(specifier, context);
  },
});
await import("./worker.ts");
