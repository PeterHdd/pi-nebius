import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const releaseManifest = JSON.parse(await readFile(".release-please-manifest.json", "utf8"));
assert.equal(releaseManifest["."], manifest.version, "Update the release manifest version");
const changelog = await readFile("CHANGELOG.md", "utf8");
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(manifest.private, true, "GitHub-only distribution must remain private to npm");
assert.equal(lock.version, manifest.version, "Update the lockfile version");
assert.equal(lock.packages[""].version, manifest.version, "Update the root lockfile version");
assert.ok(changelog.includes(`## [${manifest.version}]`), "Add this version to CHANGELOG.md");
if (process.env.RELEASE_TAG) {
  assert.equal(process.env.RELEASE_TAG, `v${manifest.version}`, "Tag must match package version");
}
console.log(`Version ${manifest.version}: manifest, lockfile, changelog, and optional tag agree.`);
