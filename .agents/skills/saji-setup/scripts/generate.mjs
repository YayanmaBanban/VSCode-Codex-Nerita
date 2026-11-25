#!/usr/bin/env node
import { mkdir, lstat, open, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const names = [
  "saji-worker",
  "arena-runner",
  "arena-judge",
  "swarm-worker",
  "interrogate-reviewer",
  "comment-sicko",
];
const templates = fileURLToPath(new URL("../agents/", import.meta.url));
const { values } = parseArgs({
  options: {
    target: { type: "string", default: "both" },
    workspace: { type: "string", default: "." },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});
if (!["pi", "codex", "both"].includes(values.target)) {
  throw new Error("--target は pi、codex、both のいずれか");
}
const workspace = resolve(values.workspace);
if (!(await stat(workspace)).isDirectory()) {
  throw new Error("Workspaceが存在しません");
}
const targets = values.target === "both" ? ["pi", "codex"] : [values.target];

function agentData(name, source) {
  const match = /^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n([\s\S]+)$/.exec(source);
  if (!match || match[1] !== name) {
    throw new Error("エージェント定義の形式が不正です: " + name);
  }
  return { name, description: match[2], prompt: match[3].trim() };
}

function asCodex({ name, description, prompt }) {
  return [
    "name = " + JSON.stringify(name),
    "description = " + JSON.stringify(description),
    "developer_instructions = " + JSON.stringify(prompt),
    "",
  ].join("\n");
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function safeDirectory(name) {
  let current = workspace;
  for (const part of [name, "agents"]) {
    current = join(current, part);
    try {
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error("ディレクトリが不正です: " + current);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  return current;
}

for (const target of targets) {
  const folder = target === "pi" ? ".pi" : ".codex";
  const directory = values["dry-run"] ? join(workspace, folder, "agents") : await safeDirectory(folder);
  for (const name of names) {
    const source = await readFile(join(templates, name + ".md"), "utf8");
    const definition = agentData(name, source);
    const path = join(directory, name + (target === "pi" ? ".md" : ".toml"));
    if (await exists(path)) {
      console.log("既存（変更しない）: " + path);
      continue;
    }
    if (values["dry-run"]) {
      console.log("作成予定: " + path);
      continue;
    }
    const content = target === "pi" ? source : asCodex(definition);
    let handle;
    try {
      handle = await open(path, "wx", 0o644);
    } catch (error) {
      if (error.code === "EEXIST") {
        console.log("既存（変更しない）: " + path);
        continue;
      }
      throw error;
    }
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
    console.log("作成: " + path);
  }
}
