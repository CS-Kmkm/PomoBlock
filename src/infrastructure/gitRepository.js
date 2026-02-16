import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeRelativePath(relativePath) {
  assert(typeof relativePath === "string" && relativePath.trim().length > 0, "path is required");
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  assert(!normalized.startsWith("/"), `absolute path is not allowed: ${relativePath}`);
  assert(!normalized.split("/").includes(".."), `path traversal is not allowed: ${relativePath}`);
  return normalized;
}

function isSensitivePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  return (
    normalized.includes("oauth") ||
    normalized.includes("token") ||
    normalized.startsWith("state/") ||
    normalized.startsWith("logs/") ||
    normalized.includes("pomodoro_log")
  );
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function walkFiles(baseDir, currentDir = "") {
  const root = currentDir ? join(baseDir, currentDir) : baseDir;
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(root)) {
    const relative = currentDir ? `${currentDir}/${entry}` : entry;
    const fullPath = join(baseDir, relative);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(baseDir, relative.replace(/\\/g, "/")));
    } else {
      files.push(relative.replace(/\\/g, "/"));
    }
  }
  return files;
}

export class GitRepository {
  constructor(repoPath) {
    this.repoPath = resolve(repoPath);
    this.metaDir = join(this.repoPath, ".pomblock");
    this.remoteDir = join(this.metaDir, "_remote");
    this.historyPath = join(this.metaDir, "git-history.json");
    this.ensureInitialized();
  }

  static init(repoPath) {
    return new GitRepository(repoPath);
  }

  ensureInitialized() {
    mkdirSync(this.repoPath, { recursive: true });
    mkdirSync(this.metaDir, { recursive: true });
    mkdirSync(this.remoteDir, { recursive: true });
    if (!existsSync(this.historyPath)) {
      writeFileSync(this.historyPath, "[]\n", "utf8");
    }
  }

  pull() {
    const remoteFiles = walkFiles(this.remoteDir);
    for (const relativePath of remoteFiles) {
      const sourcePath = join(this.remoteDir, relativePath);
      const destinationPath = join(this.repoPath, relativePath);
      ensureParentDir(destinationPath);
      copyFileSync(sourcePath, destinationPath);
    }
  }

  commitAndPush(message, files) {
    assert(typeof message === "string" && message.trim().length > 0, "message is required");
    assert(Array.isArray(files) && files.length > 0, "files are required");

    const normalizedFiles = files.map(normalizeRelativePath);
    for (const relativePath of normalizedFiles) {
      assert(
        !isSensitivePath(relativePath),
        `sensitive path cannot be committed: ${relativePath}`
      );
    }

    for (const relativePath of normalizedFiles) {
      const sourcePath = join(this.repoPath, relativePath);
      if (!existsSync(sourcePath)) {
        continue;
      }
      const destinationPath = join(this.remoteDir, relativePath);
      ensureParentDir(destinationPath);
      copyFileSync(sourcePath, destinationPath);
    }

    const history = this.readHistory();
    history.push({
      message,
      files: normalizedFiles,
      createdAt: new Date().toISOString(),
    });
    writeFileSync(this.historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  }

  readFile(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    return readFileSync(join(this.repoPath, normalized), "utf8");
  }

  writeFile(relativePath, content) {
    const normalized = normalizeRelativePath(relativePath);
    const destinationPath = join(this.repoPath, normalized);
    ensureParentDir(destinationPath);
    writeFileSync(destinationPath, content, "utf8");
  }

  writeRemoteFile(relativePath, content) {
    const normalized = normalizeRelativePath(relativePath);
    const destinationPath = join(this.remoteDir, normalized);
    ensureParentDir(destinationPath);
    writeFileSync(destinationPath, content, "utf8");
  }

  listFiles(relativeDir) {
    const normalizedDir = normalizeRelativePath(relativeDir);
    return walkFiles(join(this.repoPath, normalizedDir));
  }

  readHistory() {
    return JSON.parse(readFileSync(this.historyPath, "utf8"));
  }
}
