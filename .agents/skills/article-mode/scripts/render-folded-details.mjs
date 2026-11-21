// 媒体用 Markdown の折り畳みを生成し、既存の図などの変換へ渡す。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseArena } from "./arena-contract.mjs";
import { renderPlannedDetails } from "./folded-details.mjs";

const [arenaPath, draftPath, platform] = process.argv.slice(2);
assert.ok(arenaPath && draftPath && platform, "使い方: node render-folded-details.mjs arena.json article.md zenn|qiita");
const [source, draft] = await Promise.all([readFile(arenaPath, "utf8"), readFile(draftPath, "utf8")]);
const { approvedOutline } = parseArena(source);
assert.ok(approvedOutline?.detailPlan, "承認構成に detailPlan が必要です");
process.stdout.write(renderPlannedDetails(draft, approvedOutline.detailPlan, platform));
