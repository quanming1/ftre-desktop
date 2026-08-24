const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { listDirectoryEntries } = require("../../packages/electron/dist/ipc/fs-directory.js");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ftre-preview-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, ".hidden"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, "z.ts"), "");
  fs.writeFileSync(path.join(root, "a.ts"), "");
  fs.writeFileSync(path.join(root, ".env"), "");
  fs.writeFileSync(path.join(root, "src", "main.ts"), "");
  return root;
}

test("listDirectoryEntries validates, filters and sorts directory metadata", async () => {
  const root = createFixture();
  try {
    const result = await listDirectoryEntries(root);
    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.entries.map((entry) => [entry.name, entry.isDir]),
      [["src", true], [".env", false], ["a.ts", false], ["z.ts", false]],
    );
    assert.ok(result.entries.every((entry) => entry.path.includes("/")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listDirectoryEntries returns stable error codes", async () => {
  const root = createFixture();
  const file = path.join(root, "a.ts");
  try {
    assert.equal((await listDirectoryEntries("")).error.code, "INVALID_PATH");
    assert.equal((await listDirectoryEntries(path.join(root, "missing"))).error.code, "NOT_FOUND");
    assert.equal((await listDirectoryEntries(file)).error.code, "NOT_DIRECTORY");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("directory symlinks are exposed as non-directories and are never recursively followed", async (t) => {
  const root = createFixture();
  const link = path.join(root, "linked-src");
  try {
    try {
      fs.symlinkSync(path.join(root, "src"), link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      t.skip("当前系统不允许创建测试符号链接");
      return;
    }
    const result = await listDirectoryEntries(root);
    const entry = result.entries.find((item) => item.name === "linked-src");
    assert.ok(entry);
    assert.equal(entry.isDir, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
