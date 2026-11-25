import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const generator = fileURLToPath(new URL("../scripts/generate.mjs", import.meta.url));
const expected = [
  "saji-worker", "arena-runner", "arena-judge",
  "swarm-worker", "interrogate-reviewer", "comment-sicko",
];

function run(workspace, ...args) {
  return spawnSync(process.execPath, [generator, "--workspace", workspace, ...args], {
    encoding: "utf8",
  });
}
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "saji-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("dry-runはファイルとディレクトリを変更しない", async (t) => {
  const root = await temporary(t);
  const r = run(root, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/作成予定:/g) ?? []).length, 12);
  assert.deepEqual(await readdir(root), []);
});

test("Pi MarkdownとCodex TOMLを6件ずつ生成する", async (t) => {
  const root = await temporary(t);
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual((await readdir(join(root, ".pi", "agents"))).sort(),
    expected.map((n) => n + ".md").sort());
  assert.deepEqual((await readdir(join(root, ".codex", "agents"))).sort(),
    expected.map((n) => n + ".toml").sort());
  for (const name of expected) {
    const pi = await readFile(join(root, ".pi", "agents", name + ".md"), "utf8");
    const codex = await readFile(join(root, ".codex", "agents", name + ".toml"), "utf8");
    assert.match(pi, new RegExp("^---\\nname: " + name + "\\n"));
    assert.match(codex, new RegExp('^name = "' + name + '"\\n'));
    assert.match(codex, /developer_instructions = "/);
    assert.doesNotMatch(codex, /^model\s*=/m);
    assert.doesNotMatch(codex, /^model_reasoning_effort\s*=/m);
  }
});

test("既存定義を上書きしない", async (t) => {
  const root = await temporary(t);
  await mkdir(join(root, ".pi", "agents"), { recursive: true });
  const file = join(root, ".pi", "agents", "arena-runner.md");
  await writeFile(file, "custom", "utf8");
  const r = run(root, "--target", "pi");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await readFile(file, "utf8"), "custom");
  assert.equal((r.stdout.match(/作成:/g) ?? []).length, 5);
  assert.match(r.stdout, /既存（変更しない）/);
  assert.deepEqual((await readdir(root)).sort(), [".pi"]);
});

test("不正なtargetを拒否する", async (t) => {
  const root = await temporary(t);
  const r = run(root, "--target", "invalid");
  assert.notEqual(r.status, 0);
  assert.deepEqual(await readdir(root), []);
});
