// Arena の保存内容と、指定された工程に進む条件を確認する。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertReadyForApproval, parseArena, resolveDraftOutline } from "./arena-contract.mjs";
import { assessReviewEvidence } from "./review-evidence.mjs";

const [path, mode = "draft"] = process.argv.slice(2);
assert.ok(path, "使い方: node check-outline-arena.mjs path/to/arena.json [record|approval|draft]");
assert.ok(["record", "approval", "draft"].includes(mode), "工程は record、approval、draft のいずれかです");
const data = parseArena(await readFile(path, "utf8"));
const evidence = await assessReviewEvidence(data, path);
if (mode !== "record") {
	assert.equal(evidence.status, "verified", `独立審査の証跡が未確認です: ${evidence.reason}`);
}
if (mode === "draft") {
	console.log(JSON.stringify(resolveDraftOutline(data), null, 2));
} else {
	if (mode === "approval") {
		assertReadyForApproval(data);
	}
	console.log("Arena の保存内容を確認しました");
	console.log(JSON.stringify({ reviewEvidence: evidence }));
}
