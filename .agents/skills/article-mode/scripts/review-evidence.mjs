// Arena の現在の証跡を読み、実行を照合した記録と成果物のダイジェストを確かめる。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function digestJson(value) {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function readArtifact(directory, reference) {
	const match = reference?.match(/^([a-z0-9][a-z0-9.-]*\.json)#([a-z][a-z0-9-]*)$/iu);
	assert.ok(match, "証跡は同じディレクトリの JSON とキーで指定してください");
	const [, file, key] = match;
	const record = JSON.parse(await readFile(join(directory, file), "utf8"));
	assert.ok(Object.hasOwn(record, key), `証跡のキーが見つかりません: ${key}`);
	return record[key];
}

async function verifyRun(directory, run) {
	assert.ok(run?.runId, "実行 ID がありません");
	const [input, output] = await Promise.all([
		readArtifact(directory, run.inputRef),
		readArtifact(directory, run.artifactRef),
	]);
	assert.equal(digestJson(input), run.inputHash, "入力のダイジェストが一致しません");
	assert.equal(digestJson(output), run.outputDigest, "出力のダイジェストが一致しません");
	assert.equal(output.runId, run.runId, "出力と実行 ID が一致しません");
	if (run.candidateId !== undefined) {
		assert.equal(output.candidate.id, run.candidateId, "生成結果と候補 ID が一致しません");
	}
	return { input, output };
}

async function verifyContext(directory, execution, ids) {
	const context = await readArtifact(directory, execution.contextEvidenceRef);
	assert.equal(context.separateContextsObserved, true, "生成担当と審査担当が別コンテキストだったことを確認してください");
	assert.ok(typeof context.observation === "string" && context.observation.trim(), "実行を確認した根拠が必要です");
	assert.deepEqual(context.runIds, ids, "確認した実行と保存した証跡が一致しません");
	assert.ok(context.anonymizedFields.includes("author") && context.anonymizedFields.includes("model"), "匿名にした項目を記録してください");
	return context;
}

function verifyOpeningReview(judge, candidates, context) {
	const { openings } = judge.input;
	const { firstParagraph, openingOnly } = judge.output;
	const hasOpeningArtifacts = [openings, firstParagraph, openingOnly].some((value) => value !== undefined);
	if (!hasOpeningArtifacts && candidates.every(({ review }) => review?.openingAssessment === undefined)) {
		return;
	}
	assert.deepEqual(context.reviewStages, ["title-only", "first-paragraph", "introduction", "full-outline"], "導入を段階ごとに読んだ順序が記録されていません");
	assert.deepEqual(openings, candidates.map(({ id, title, opening }) => ({ id, title, opening })), "導入単独レビューに渡した題名・導入が比較案と一致しません");
	const ids = candidates.map(({ id }) => id);
	assert.deepEqual(Object.keys(firstParagraph ?? {}).sort(), ids, "冒頭1段落の審査結果が3案分必要です");
	assert.deepEqual(Object.keys(openingOnly ?? {}).sort(), ids, "導入単独の審査結果が3案分必要です");
	for (const { id, review } of candidates) {
		const { curiosity, observed } = firstParagraph[id] ?? {};
		assert.ok([curiosity, observed].every((value) => typeof value === "string" && value.trim()), "最初の段落から生まれた疑問と観察が必要です");
		assert.deepEqual(openingOnly[id], review?.openingAssessment, "保存した導入単独レビューと比較案の評価が一致しません");
	}
}

// 旧記録の表示は維持し、新たな執筆の判断では現在確認できる証跡だけを使う。
export async function assessReviewEvidence(data, arenaPath) {
	const execution = data.reviewExecution;
	const directory = dirname(arenaPath);
	try {
		assert.equal(execution.independence, "verified", "独立実行が未確認です");
		const runs = [...execution.generatorRuns, execution.judgeRun];
		assert.equal(runs.length, 4, "生成3件と審査1件が必要です");
		const ids = runs.map((run) => run?.runId);
		assert.equal(new Set(ids).size, 4, "実行が分かれていません");
		const context = await verifyContext(directory, execution, ids);
		const [a, b, c, judge] = await Promise.all(runs.map((run) => verifyRun(directory, run)));
		const generatedRuns = [a, b, c];
		const candidates = generatedRuns.map((run) => run.output.candidate);
		for (const generated of generatedRuns) {
			assert.equal(generated.input.inputRevision, execution.inputRevision, "共通の入力版が一致しません");
			assert.equal(generated.input.sharedBrief, judge.input.sharedBrief, "生成と審査の共通条件が一致しません");
			const { id, title } = generated.output.candidate;
			const displayed = data.candidates.find((candidate) => candidate.id === id);
			assert.equal(displayed?.title, title, "表示する題名と保存した候補が一致しません");
			assert.deepEqual(displayed.sections.map((section) => section.heading), generated.output.headings, "表示する見出しと保存した候補が一致しません");
		}
		assert.ok(execution.inputRevision, "共通の入力版が未記録です");
		assert.equal(judge.input.inputRevision, execution.inputRevision, "審査の入力版が一致しません");
		assert.deepEqual(judge.input.candidates, candidates, "審査に渡した案と生成された案が一致しません");
		assert.deepEqual(judge.input.titles, candidates.map(({ id, title }) => ({ id, title })), "冒頭のタイトル単独審査に渡した題名が一致しません");
		assert.deepEqual(Object.keys(judge.output.titleOnly).sort(), candidates.map(({ id }) => id).sort(), "タイトル単独審査の回答が揃っていません");
		verifyOpeningReview(judge, data.candidates, context);
		for (const candidate of judge.input.candidates) {
			assert.ok(!Object.hasOwn(candidate, "author") && !Object.hasOwn(candidate, "model"), "匿名入力に作成者またはモデルが含まれます");
		}
		return { status: "verified", reason: "別コンテキストを確認した記録と、入出力・匿名候補が一致しました" };
	} catch (error) {
		return { status: "unverified", reason: error.message };
	}
}
