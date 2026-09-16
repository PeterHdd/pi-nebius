import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const excluded = (path: string) =>
  path
    .split(/[\\/]/)
    .some(
      (name) =>
        [
          ".git",
          ".pi",
          "node_modules",
          "benchmark-results",
          "dist",
          "build",
          "coverage",
          ".next",
        ].includes(name) ||
        name === ".env" ||
        name.startsWith(".env.") ||
        /\.(pem|key)$/.test(name),
    );

/** Snapshot working files, respecting Git ignores, without dependency trees or known credential files. */
export async function snapshotProject(source: string, target: string) {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: source,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    const walk = async (prefix = ""): Promise<string[]> => {
      const found: string[] = [];
      for (const entry of await readdir(join(source, prefix), { withFileTypes: true })) {
        const path = join(prefix, entry.name);
        if (excluded(path)) continue;
        if (entry.isDirectory()) found.push(...(await walk(path)));
        else found.push(path);
      }
      return found;
    };
    files = await walk();
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  let bytes = 0;
  let copied = 0;
  for (const path of new Set(files)) {
    if (excluded(path)) continue;
    const info = await lstat(join(source, path)).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile())
      throw new Error(`Cannot snapshot ${path}: only regular project files are supported.`);
    bytes += info.size;
    if (++copied > 10000 || bytes > 50 * 1024 * 1024)
      throw new Error(
        "Project snapshot exceeds 10,000 files or 50 MiB. Run Pi from a smaller project directory.",
      );
    await mkdir(dirname(join(target, path)), { recursive: true, mode: 0o700 });
    await cp(join(source, path), join(target, path));
  }
  return copied;
}
