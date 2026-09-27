import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	filterFilesByTargets,
	resolveTextlintTargets,
} from "../scripts/textlint-targets.mjs";

test("accepts repository files and folders and rejects paths outside the repository", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-textlint-"));

	try {
		await fs.mkdir(path.join(root, "docs", "nested"), { recursive: true });
		await fs.mkdir(path.join(root, "src"), { recursive: true });
		await fs.writeFile(path.join(root, "docs", "a.md"), "a");
		await fs.writeFile(path.join(root, "docs", "nested", "b.md"), "b");
		await fs.writeFile(path.join(root, "src", "a.ts"), "a");

		const targets = await resolveTextlintTargets(root, ["docs", "src/a.ts"]);

		assert.deepEqual(
			filterFilesByTargets(
				["docs/a.md", "docs/nested/b.md", "src/a.ts", "src/b.ts"],
				targets,
			),
			["docs/a.md", "docs/nested/b.md", "src/a.ts"],
		);

		await assert.rejects(
			() => resolveTextlintTargets(root, ["../outside"]),
			/outside repository/,
		);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
