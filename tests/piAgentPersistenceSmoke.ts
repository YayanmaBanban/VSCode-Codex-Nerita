// 実 SDK の JSONL を開き直し、子の会話とフォーク先の親子関係を検証する。
import * as assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	createPiRuntime,
	type PiRuntimeOptions,
	type PiRuntimeSession,
} from "../src/extension/backends/pi/PiRuntime";

/** 保存済みの子を読み直してもモデルや承認を呼び出さない。 */
export async function piAgentPersistenceSmoke(
	parent: PiRuntimeSession,
	options: PiRuntimeOptions,
) {
	const cards = parent.agentViews!.list();
	const view = parent.agentViews!.read(cards[0]!.threadId);
	const target = parent.history!.target(parent.sessionId);
	const files = (await readdir(target.directory)).filter((name) =>
		name.endsWith(".jsonl"),
	);
	assert.equal(files.length, 1);
	assert.ok(
		(await readFile(join(target.directory, files[0]!), "utf8")).includes(
			'"customType":"nerita.subagent.v1"',
		),
	);
	if (options.storage === "workspace") {
		assert.equal(target.directory, join(options.cwd, ".sessions"));
	}
	await parent.close();
	const deny = () => {
		throw new Error("履歴の復元が承認を要求しました。");
	};
	const resumed = await createPiRuntime({
		...options,
		authorize: deny,
		resume: target,
	});
	try {
		assert.equal(resumed.sessionId, parent.sessionId);
		assert.deepEqual(resumed.agentViews!.list(), cards);
		assert.deepEqual(resumed.agentViews!.read(cards[0]!.threadId), view);
		for (const card of cards) {
			assert.deepEqual(
				resumed.agentViews!.read(card.threadId),
				parent.agentViews!.read(card.threadId),
			);
		}
		assert.equal((await resumed.history!.list(options.signal)).length, 1);
	} finally {
		await resumed.close();
	}
	const fork = await createPiRuntime({
		...options,
		authorize: deny,
		resume: { ...target, fork: true },
	});
	try {
		assert.notEqual(fork.sessionId, parent.sessionId);
		assert.equal(fork.agentViews!.list().length, cards.length);
		assert.equal(
			fork.agentViews!.read(cards[0]!.threadId).parentThreadId,
			fork.sessionId,
		);
		assert.deepEqual(
			fork.agentViews!.read(cards[0]!.threadId).messages,
			view.messages,
		);
		assert.equal((await fork.history!.list(options.signal)).length, 2);
	} finally {
		await fork.close();
	}
}
