import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// Reuse the installed host's SDK; Git installs intentionally omit Pi dev dependencies.
const hostEntry = process.argv[2];
if (!hostEntry) throw new Error("Missing host Pi entry");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@earendil-works/"))
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(hostEntry).href });
    return nextResolve(specifier, context);
  },
});
await import("./worker.ts");
