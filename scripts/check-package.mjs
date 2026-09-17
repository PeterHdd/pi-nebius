import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const scratch = await mkdtemp(join(tmpdir(), "pi-nebius-package-"));
try {
  const [pack] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
      encoding: "utf8",
    }),
  );
  const names = pack.files.map((file) => file.path);
  for (const required of [
    "src/index.ts",
    "src/benchmark/host-worker.mjs",
    "dist/benchmark/host-worker.mjs",
    "dist/benchmark/cli.js",
    "dist/benchmark/worker.js",
    "README.md",
  ])
    assert.ok(names.includes(required), `Missing package entry: ${required}`);
  for (const name of names)
    assert.doesNotMatch(
      name,
      /(?:^|\/)(?:node_modules|tests|benchmark-results|\.env(?:\..*)?)(?:\/|$)/,
    );
  // Resolve the tested peers explicitly; wildcard peer declarations follow Pi package conventions.
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      scratch,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(scratch, pack.filename),
      ...Object.entries(manifest.devDependencies)
        .filter(([name]) => name.startsWith("@earendil-works/"))
        .map(([name, version]) => `${name}@${version}`),
    ],
    { stdio: "inherit" },
  );
  const cli = join(scratch, "node_modules/pi-nebius/dist/benchmark/cli.js");
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(help, /Usage: pi-nebius benchmark/);
  await import(pathToFileURL(join(scratch, "node_modules/pi-nebius/dist/index.js")));
  console.log(
    `Packed ${pack.files.length} files; clean package install and compiled imports/CLI passed.`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
