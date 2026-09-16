import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface Entry {
  path: string;
  directory: boolean;
  executable: number;
}

/** Reject links/special files rather than risk a copy retaining access to the source fixture. */
async function treeEntries(root: string, prefix = ""): Promise<Entry[]> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new Error("Fixture root must be a real directory, not a symbolic link");
  const files: Entry[] = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    if (name === ".git") continue;
    if (name === ".env" || name.startsWith(".env."))
      throw new Error("Fixtures must not contain .env credential files");
    const relative = prefix ? `${prefix}/${name}` : name;
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
      throw new Error(
        `Unsupported fixture entry: ${relative} (links/special files are not allowed)`,
      );
    files.push({ path: relative, directory: info.isDirectory(), executable: info.mode & 0o111 });
    if (info.isDirectory()) files.push(...(await treeEntries(root, relative)));
  }
  return files;
}
export async function treeFiles(root: string): Promise<string[]> {
  return (await treeEntries(root)).filter((entry) => !entry.directory).map((entry) => entry.path);
}
export async function hashTree(root: string): Promise<string> {
  const digest = createHash("sha256");
  for (const entry of await treeEntries(root)) {
    const content = entry.directory ? Buffer.alloc(0) : await readFile(join(root, entry.path));
    digest.update(
      JSON.stringify([
        entry.path,
        entry.directory,
        entry.directory ? 0 : entry.executable,
        content.length,
      ]),
    );
    digest.update(content);
  }
  return digest.digest("hex");
}
export async function copyTree(source: string, target: string) {
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const entry of await treeEntries(source)) {
    const sourcePath = join(source, entry.path);
    const targetPath = join(target, entry.path);
    if (entry.directory) {
      await mkdir(targetPath, { recursive: true, mode: 0o700 });
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
    await copyFile(sourcePath, targetPath);
    await chmod(targetPath, 0o600 | entry.executable);
  }
}
