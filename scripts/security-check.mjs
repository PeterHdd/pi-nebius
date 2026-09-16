// Official release binaries only; verify committed SHA-256 pins before extraction/execution.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const pins = JSON.parse(await readFile(new URL("./security-tools.json", import.meta.url), "utf8"));
const target = `${process.platform}-${process.arch}`;
const scratch = await mkdtemp(join(tmpdir(), "pi-nebius-security-"));
const run = (file, args) => execFileSync(file, args, { stdio: "inherit" });
try {
  for (const [name, tool] of Object.entries(pins)) {
    const asset = tool.assets[target];
    if (!asset) throw new Error(`Unsupported security-tool platform: ${target}`);
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`${name} download: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) throw new Error(`${name}: checksum mismatch; refusing execution`);
    const directory = join(scratch, name);
    await mkdir(directory);
    const archive = join(directory, "tool.tar.gz");
    await writeFile(archive, bytes, { mode: 0o600 });
    run("tar", ["-xzf", archive, "-C", directory, name]);
    const binary = join(directory, name);
    if (name === "actionlint") {
      // ShellCheck is optional locally; actionlint still validates workflow structure/expressions.
      run(binary, ["-color", "-shellcheck=", "-pyflakes="]);
      continue;
    }
    // Include untracked first-party files before the initial commit, honor gitignore,
    // and avoid scanning installed dependencies or generated benchmark workspaces.
    const files = execFileSync("git", [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ])
      .toString()
      .split("\0")
      .filter(Boolean);
    const snapshot = join(scratch, "source");
    await mkdir(snapshot);
    for (const file of new Set(files)) {
      const info = await lstat(file).catch((error) => {
        if (error.code === "ENOENT") return null; // Deleted tracked file.
        throw error;
      });
      if (!info) continue;
      if (!info.isFile())
        throw new Error(`Refusing to scan a non-regular repository file: ${file}`);
      const destination = join(snapshot, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(file, destination);
    }
    run(binary, ["dir", snapshot, "--redact", "--no-banner"]);
    let hasHistory = false;
    try {
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], { stdio: "ignore" });
      hasHistory = true;
    } catch {
      /* New local repository: working-tree scan still ran. */
    }
    if (hasHistory) run(binary, ["git", ".", "--redact", "--no-banner", "--log-opts=--all"]);
    else console.log("No commits yet: history scan skipped; first-party working tree scanned.");
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
