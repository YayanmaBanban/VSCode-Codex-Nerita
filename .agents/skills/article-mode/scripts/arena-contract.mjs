// Arena の保存データを検査し、承認された版を執筆担当へ渡す。
import assert from "node:assert/strict";

import { validateDetailPlan } from "./folded-details.mjs";

const candidateIds = ["A", "B", "C"];
const editorialIssueTypes = [
	"editorial-voice",
	"artificial-curiosity",
	"intro-dependency",
	"premature-detail",
	"evidence-scope",
	"skill-value-missing",
	"title-authorship",
	"transition-gap",
	"section-role-loss",
	"heading-overload",
	"example-evidence-gap",
	"attribution-misattribution",
	"reference-placement",
	"artifact-focus-drift",
	"detached-guideline",
];
const referencePlacements = new Map([
	["inspiration", "introduction"],
	["claim-evidence", "near-claim"],
	["further-reading", "end"],
]);

function requireText(value, field) {
	assert.ok(typeof value === "string" && value.trim(), `${field} は空でない文字列が必要です`);
}

function requireTexts(values, field) {
	assert.ok(Array.isArray(values), `${field} は配列が必要です`);
	for (const value of values) {
		requireText(value, field);
	}
}

function requireReferences(values, allowed, field) {
	requireTexts(values, field);
	assert.ok(values.every((value) => allowed.includes(value)), `${field} に未定義の ID があります`);
}

function validateEditorialIssue(issue, evidenceIds) {
	assert.ok(editorialIssueTypes.includes(issue.type), "編集上の指摘種別が不明です");
	for (const field of ["location", "observed", "whyReaderCares", "suggestedAction"]) {
		requireText(issue[field], `issue.${field}`);
	}
	requireReferences(issue.evidenceIds ?? issue.evidenceRefs, evidenceIds, "編集上の指摘の根拠 ID");
	assert.ok(["blocking", "major", "minor"].includes(issue.severity), "不明な指摘の重大度です");
}

function validateCandidateReview(review, evidenceIds) {
	for (const field of ["problem", "attempt", "readerValue"]) {
		requireText(review.openingAssessment?.[field], `openingAssessment.${field}`);
	}
	assert.ok(Array.isArray(review.issues), "候補の編集上の指摘は issues 配列に記録してください");
	for (const issue of review.issues) {
		validateEditorialIssue(issue, evidenceIds);
	}
}

function validateArtifactIntent(intent) {
	if (intent.artifactRole !== undefined) {
		assert.ok(["created", "adopted", "reviewed", null].includes(intent.artifactRole), "制作物と筆者の関係が不明です");
	}
	for (const field of ["artifactName", "artifactValue", "articlePrimarySubject"]) {
		if (Object.hasOwn(intent, field) && intent[field] !== null) {
			requireText(intent[field], `articleIntent.${field}`);
		}
	}
	if (intent.exampleTopics !== undefined) {
		requireTexts(intent.exampleTopics, "articleIntent.exampleTopics");
	}
}

function validateArticleIntent(intent) {
	assert.ok(["skill-introduction", "development-record", "verification", "tutorial"].includes(intent.kind), "記事の目的が不明です");
	requireText(intent.readerValue, "articleIntent.readerValue");
	if (intent.kind === "skill-introduction" || intent.skillValue !== undefined) {
		requireText(intent.skillValue, "articleIntent.skillValue");
	}
	if (intent.kind === "skill-introduction" || intent.agentRequest !== undefined) {
		requireText(intent.agentRequest, "articleIntent.agentRequest");
	}
	validateArtifactIntent(intent);
}

function validateMotivationEvidence(motivation) {
	assert.ok(["user-statement", "documented", "editorial-example", "unconfirmed"].includes(motivation.kind), "制作動機の確認状態が不明です");
	if (["user-statement", "documented"].includes(motivation.kind)) {
		requireText(motivation.sourceRef, "motivationEvidence.sourceRef");
	}
	requireText(motivation.note, "motivationEvidence.note");
}

function validateBrief(brief) {
	for (const field of ["topic", "reader", "authorMotivation", "coreThesis"]) {
		requireText(brief[field], `brief.${field}`);
	}
	for (const field of ["mustPreserve", "mandatoryTopics", "constraints"]) {
		requireTexts(brief[field], `brief.${field}`);
	}
	assert.ok(Array.isArray(brief.evidence), "brief.evidence は配列が必要です");
	const evidenceIds = [];
	for (const evidence of brief.evidence) {
		for (const field of ["id", "claim", "verificationNote"]) {
			requireText(evidence[field], `evidence.${field}`);
		}
		assert.ok(["verified", "illustrative", "unverified"].includes(evidence.status), "不明な根拠の状態です");
		if (evidence.status === "verified") {
			requireText(evidence.sourceRef, "verified な根拠の sourceRef");
		} else if (evidence.sourceRef !== null) {
			requireText(evidence.sourceRef, "evidence.sourceRef");
		}
		evidenceIds.push(evidence.id);
	}
	assert.equal(new Set(evidenceIds).size, evidenceIds.length, "根拠 ID が重複しています");
	if (brief.articleIntent !== undefined) {
		validateArticleIntent(brief.articleIntent);
	}
	if (brief.motivationEvidence !== undefined) {
		validateMotivationEvidence(brief.motivationEvidence);
	}
	return evidenceIds;
}

function validateReference(reference, evidenceIds) {
	requireText(reference.id, "reference.id");
	requireText(reference.url, "reference.url");
	assert.ok(URL.canParse(reference.url) && ["http:", "https:"].includes(new URL(reference.url).protocol), "参照先は HTTP(S) の URL で指定してください");
	assert.ok(referencePlacements.has(reference.role) || reference.role === "unclassified", "参照資料の役割が不明です");
	assert.ok(["user", "agent"].includes(reference.providedBy), "参照資料の提供元が不明です");
	assert.ok([true, false, null].includes(reference.confirmedInfluence), "制作への影響を確認した状態が必要です");
	assert.ok(["verified", "unverified", "unavailable"].includes(reference.verificationStatus), "参照資料の確認状態が不明です");
	for (const field of ["title", "author", "influencedPart"]) {
		if (reference[field] !== null) {
			requireText(reference[field], `reference.${field}`);
		}
	}
	requireReferences(reference.claimIds, evidenceIds, "reference.claimIds");
}

function validateBriefReferences(references, evidenceIds) {
	assert.ok(Array.isArray(references), "brief.references は配列が必要です");
	const byId = new Map();
	for (const reference of references) {
		validateReference(reference, evidenceIds);
		assert.ok(!byId.has(reference.id), "参照資料の ID が重複しています");
		if (reference.role === "inspiration") {
			assert.equal(reference.confirmedInfluence, true, "制作への影響は本人の確認が必要です");
			requireText(reference.influencedPart, "reference.influencedPart");
		}
		if (reference.role === "claim-evidence") {
			assert.ok(reference.claimIds.length > 0, "技術的な根拠と対応する主張 ID が必要です");
		}
		byId.set(reference.id, reference);
	}
	return byId;
}

function validateAttributionPlan(plan, references) {
	assert.ok(Array.isArray(plan), "attributionPlan は配列が必要です");
	for (const entry of plan) {
		const reference = references.get(entry.referenceId);
		assert.ok(reference && referencePlacements.has(reference.role), "配置する参照資料の役割を確定してください");
		assert.equal(entry.placement, referencePlacements.get(reference.role), "参照資料の役割に対応する配置を指定してください");
		requireText(entry.note, "attributionPlan.note");
		if (reference.role === "claim-evidence") {
			assert.ok(reference.claimIds.includes(entry.evidenceId), "根拠のリンクは対応する主張に配置してください");
		}
	}
}

function validateExampleEvidence(plan, evidenceIds, verifiedIds) {
	assert.ok(Array.isArray(plan), "exampleEvidencePlan は配列が必要です");
	for (const example of plan) {
		for (const field of ["claim", "beforeProblem", "afterMeaning", "scope"]) {
			requireText(example[field], `exampleEvidencePlan.${field}`);
		}
		requireReferences(example.evidenceIds, evidenceIds, "exampleEvidencePlan.evidenceIds");
		assert.ok(["verified", "illustrative", "unverified"].includes(example.status), "具体例の検証状態が不明です");
		if (example.status === "verified") {
			assert.ok(example.evidenceIds.some((id) => verifiedIds.includes(id)), "検証済みの具体例には確認済みの根拠が必要です");
		}
	}
}

function validateEvidenceAndAttribution(data, evidenceIds) {
	const references = validateBriefReferences(data.brief.references ?? [], evidenceIds);
	const verifiedIds = data.brief.evidence.filter(({ status }) => status === "verified").map(({ id }) => id);
	for (const outline of [...data.candidates, data.approvedOutline].filter(Boolean)) {
		if (outline.attributionPlan !== undefined) {
			validateAttributionPlan(outline.attributionPlan, references);
		}
		for (const section of outline.sections ?? []) {
			if (section.exampleEvidencePlan !== undefined) {
				validateExampleEvidence(section.exampleEvidencePlan, evidenceIds, verifiedIds);
			}
		}
	}
}

function validateExecution(execution) {
	assert.ok(["verified", "unverified"].includes(execution.independence), "独立性の状態が不明です");
	assert.ok(Array.isArray(execution.generatorRuns), "generatorRuns は配列が必要です");
	if (execution.inputRevision !== null) {
		requireText(execution.inputRevision, "reviewExecution.inputRevision");
	}
	const diversity = execution.diversity;
	assert.ok(["distinct", "insufficient", "unverified"].includes(diversity.status), "案の差の判定が不明です");
	requireText(diversity.basis, "候補の差を判断した根拠");
	if (execution.independence === "verified") {
		const runs = execution.generatorRuns;
		assert.deepEqual(runs.map((run) => run.candidateId).sort(), candidateIds);
		const runIds = [...runs, execution.judgeRun].map((run) => run?.runId);
		requireTexts(runIds, "独立性を確認した実行 ID");
		assert.equal(new Set(runIds).size, 4, "候補と審査の実行 ID は別々である必要があります");
	}
}

function validateSectionRole(section, hasNext) {
	const fields = ["readerQuestion", "sectionRole", "takeaway"];
	if (![...fields, "nextBridge"].some((field) => Object.hasOwn(section, field))) {
		return;
	}
	for (const field of fields) {
		requireText(section[field], `section.${field}`);
	}
	if (hasNext) {
		requireText(section.nextBridge, "section.nextBridge");
	} else {
		assert.equal(section.nextBridge, null, "最終章の nextBridge は null にします");
	}
}

function validateSectionRoleDestination(decision, sections) {
	if (decision.disposition === "omitted") {
		assert.equal(decision.sectionId, null, "見送った役割には採用先の章を指定できません");
		return;
	}
	const section = sections.find(({ id }) => id === decision.sectionId);
	assert.ok(section?.sourceCandidateIds.includes(decision.candidateId), "章の役割の採用元と採用先が一致しません");
}

function validateSectionRoleDecisions(outline, candidates) {
	const { sectionRoleDecisions } = outline;
	if (sectionRoleDecisions === undefined) {
		return;
	}
	assert.ok(Array.isArray(sectionRoleDecisions), "sectionRoleDecisions は配列が必要です");
	for (const decision of sectionRoleDecisions) {
		const source = candidates.find(({ id }) => id === decision.candidateId);
		assert.ok(source?.sections.some(({ heading }) => heading === decision.sourceHeading), "候補にない章の役割です");
		requireText(decision.sectionRole, "decision.sectionRole");
		requireText(decision.basis, "decision.basis");
		assert.ok(["kept", "merged", "omitted"].includes(decision.disposition), "章の役割の採否が不明です");
		validateSectionRoleDestination(decision, outline.sections);
	}
}

function validateOutline(outline, approval, evidenceIds) {
	requireText(outline.title, "approvedOutline.title");
	requireText(outline.opening, "approvedOutline.opening");
	requireTexts(outline.preservedIntent, "preservedIntent");
	requireTexts(outline.explicitScopeChanges, "explicitScopeChanges");
	assert.deepEqual(outline.explicitScopeChanges, approval.scopeChanges, "承認された変更と確定構成が一致しません");
	assert.ok(Number.isSafeInteger(outline.revision) && outline.revision > 0, "構成の改訂番号が必要です");
	assert.equal(outline.revision, approval.approvedOutlineRevision, "承認された改訂番号と構成が一致しません");
	assert.ok(Array.isArray(outline.sections) && outline.sections.length > 0, "確定構成に章がありません");
	if (outline.titleContract !== undefined) {
		const contract = outline.titleContract;
		assert.equal(contract.titleText, outline.title, "タイトル契約と承認構成の題名が一致しません");
		assert.equal(contract.userApproved, true, "題名の約束と承認を関連付けてください");
		requireText(contract.pattern, "titleContract.pattern");
		requireText(contract.promise, "titleContract.promise");
		requireTexts(contract.mustDeliver, "titleContract.mustDeliver");
		assert.ok(contract.mustDeliver.length, "題名の約束に対応する内容が必要です");
	}
	if (outline.detailPlan !== undefined) {
		validateDetailPlan(outline.detailPlan, outline.sections);
	}
	const adopted = [approval.baseCandidateId, ...approval.incorporatedFrom];
	const sectionIds = new Set();
	for (const [index, section] of outline.sections.entries()) {
		validateSectionRole(section, index < outline.sections.length - 1);
		for (const field of ["id", "heading", "claim"]) {
			requireText(section[field], `section.${field}`);
		}
		requireReferences(section.evidenceIds, evidenceIds, "章の根拠 ID");
		requireReferences(section.sourceCandidateIds, adopted, "章の採用元");
		assert.ok(section.sourceCandidateIds.length > 0, "章の採用元がありません");
		requireTexts(section.foldedDetails, "foldedDetails");
		if (section.diagramPlan !== null) {
			requireText(section.diagramPlan, "diagramPlan");
		}
		assert.ok(!sectionIds.has(section.id), "章 ID が重複しています");
		sectionIds.add(section.id);
	}
}

function validateApproval(data, evidenceIds) {
	const { approval, approvedOutline } = data;
	assert.ok(["pending", "approved", "revision_requested"].includes(approval.status), "不明な承認状態です");
	requireTexts(approval.scopeChanges, "scopeChanges");
	requireReferences(approval.incorporatedFrom, candidateIds, "取り込んだ候補 ID");
	if (approval.rawResponse !== null) {
		requireText(approval.rawResponse, "rawResponse");
	}
	if (approval.status !== "approved") {
		assert.equal(approvedOutline, null, "承認前の確定構成は null にします");
		assert.equal(approval.approvedOutlineRevision, null, "承認前の構成改訂番号は null にします");
		return;
	}
	requireText(approval.rawResponse, "承認したユーザーの原文");
	assert.ok(candidateIds.includes(approval.baseCandidateId), "採用した候補 ID が不明です");
	const adopted = [approval.baseCandidateId, ...approval.incorporatedFrom];
	assert.equal(new Set(adopted).size, adopted.length, "採用した候補 ID が重複しています");
	validateOutline(approvedOutline, approval, evidenceIds);
	validateSectionRoleDecisions(approvedOutline, data.candidates);
}

function validateFidelityIssue(issue, evidenceIds) {
	const editorial = editorialIssueTypes.includes(issue.type);
	if (editorial) {
		validateEditorialIssue(issue, evidenceIds);
	} else if (issue.type !== undefined) {
		assert.ok(["title-promise", "presentation-mismatch", "final-takeaway"].includes(issue.type), "指摘の種別が不明です");
	}
	for (const field of ["id", "outlineRef", "draftRef", "expected", "observed", "suggestedAction"]) {
		requireText(issue[field], `issue.${field}`);
	}
	assert.ok(["blocking", "major", "minor"].includes(issue.severity), "不明な指摘の重大度です");
	if (!editorial) {
		requireReferences(issue.evidenceIds, evidenceIds, "指摘の根拠 ID");
	}
	assert.ok(["resolved", "unresolved"].includes(issue.resolution), "指摘の解消状態が不明です");
	if (issue.resolution === "resolved") {
		requireText(issue.resolutionEvidence, "指摘が解消した根拠");
	}
}

function validateFidelity(review, outline, evidenceIds) {
	assert.ok(["pending", "passed", "needs_revision"].includes(review.status), "構成一致レビューの状態が不明です");
	assert.equal(review.outlineRevision, outline?.revision ?? null, "構成一致レビューの対象版が違います");
	assert.ok(Array.isArray(review.issues), "issues は配列が必要です");
	if (review.status !== "pending") {
		requireText(review.draftRevision, "draftRevision");
		assert.ok(outline, "確定した構成がない原稿はレビューできません");
	}
	if (review.reviewedAt !== null) {
		requireText(review.reviewedAt, "reviewedAt");
	}
	for (const issue of review.issues) {
		validateFidelityIssue(issue, evidenceIds);
	}
	if (review.status === "passed") {
		assert.ok(
			review.issues.every((issue) => issue.severity === "minor" || issue.resolution === "resolved"),
			"未解消の重大な指摘がある構成一致レビューは完了できません",
		);
	}
}

function validateTitleDesign(design) {
	for (const field of ["pattern", "readerCue", "promisedValue", "curiosityLeft", "risk"]) {
		requireText(design[field], `titleDesign.${field}`);
	}
	for (const field of ["ownershipCue", "artifactNameCue"]) {
		assert.equal(typeof (design[field] ?? ""), "string", `titleDesign.${field} は文字列または空欄で指定してください`);
	}
}

// 比較ページ用のフィールドを含め、読み取ったオブジェクトをそのまま返す。
export function parseArena(source) {
	const data = JSON.parse(source);
	assert.equal(data.schemaVersion, 2, "Arena の schemaVersion は 2 が必要です");
	assert.deepEqual(data.candidates.map((candidate) => candidate.id), candidateIds);
	const evidenceIds = validateBrief(data.brief);
	const hasOpeningReview = data.candidates.some(({ review }) => review?.openingAssessment !== undefined || review?.issues !== undefined);
	for (const candidate of data.candidates) {
		if (hasOpeningReview) {
			validateCandidateReview(candidate.review ?? {}, evidenceIds);
		}
		if (candidate.titleDesign !== undefined) {
			validateTitleDesign(candidate.titleDesign);
		}
	}
	for (const field of ["recommendation", "decision"]) {
		if (data[field] !== undefined) {
			requireText(data[field], field);
		}
	}
	validateExecution(data.reviewExecution);
	validateApproval(data, evidenceIds);
	validateEvidenceAndAttribution(data, evidenceIds);
	validateFidelity(data.fidelityReview, data.approvedOutline, evidenceIds);
	return data;
}

function validateReply(approval, data) {
	const reply = approval.rawResponse.trim();
	if (/^推奨(?:で(?:お願いします|進めてください)?)?[。！!]?$/u.test(reply)) {
		const recommendation = data.reviewExecution.recommendedSelection;
		requireText(data.recommendation, "ユーザーに提示した推薦");
		assert.ok(recommendation, "ユーザーが選んだ推薦の構成が必要です");
		assert.equal(approval.baseCandidateId, recommendation.baseCandidateId, "推薦と採用案が一致しません");
		assert.deepEqual(approval.incorporatedFrom, recommendation.incorporatedFrom, "推薦と取り込んだ候補が一致しません");
		assert.deepEqual(approval.scopeChanges, recommendation.scopeChanges, "推薦と承認範囲が一致しません");
		return;
	}
	const choice = reply.match(/^([ABC])案?(?:で(?:お願いします|進めてください)?|を採用(?:します|してください)?|にします)?[。！!]?$/u);
	if (choice) {
		assert.equal(choice[1], approval.baseCandidateId, "ユーザーの選択と採用案が一致しません");
		assert.equal(approval.incorporatedFrom.length, 0, "単独採用に未承認の候補が含まれています");
		assert.equal(approval.scopeChanges.length, 0, "単独採用に未承認の変更が含まれています");
		return;
	}
	const combination = reply.match(/^([ABC])\s*[+＋]\s*([ABC])(?:\s*[+＋]\s*([ABC]))?(?:で(?:お願いします|進めてください)?)?[。！!]?$/u);
	const integration = reply.match(/^([ABC])案?\s*を(?:軸|ベース)に[、\s]*([ABC])[^。！？]*を(?:加えて|取り入れて|取り込んで|追加して)(?:進めて)?ください[。！!]?$/u);
	const selected = combination ?? integration;
	if (selected) {
		const [, base, ...others] = selected;
		assert.equal(base, approval.baseCandidateId, "ユーザーが指定した基準案が一致しません");
		assert.deepEqual(others.filter(Boolean).sort(), [...approval.incorporatedFrom].sort(), "ユーザーが指定した統合候補が一致しません");
		if (combination) {
			assert.equal(approval.scopeChanges.length, 0, "候補 ID の指定に未承認の変更が含まれています");
		}
		return;
	}
	if (hasExplicitScopeInstruction(reply, approval.scopeChanges)) {
		return;
	}
	// 自由文は、実際に示した構成への確認応答から承認を記録する。
	assert.match(reply, /^(?:この構成|提示された構成)で(?:進めてください|お願いします)[。！!]?$/u, "明示的な構成承認がありません");
}

function hasExplicitScopeInstruction(reply, scopeChanges) {
	if (scopeChanges.length === 0) {
		return false;
	}
	// 明示的な範囲変更は、解釈の要約ではなく返信にある指示を保存する。
	const sentences = reply.split(/[。！!\r\n]/u).map((sentence) => sentence.trim()).filter(Boolean);
	if (sentences.length !== scopeChanges.length) {
		return false;
	}
	return scopeChanges.every(
		(change, index) => sentences[index] === change && /(?:にする|(?:削って|省いて|加えて|含めて|変えて|残して)ください)$/u.test(change),
	);
}

// 比較の表示と執筆への引き渡しで必要な条件を分ける。
export function assertReadyForApproval(data) {
	assert.equal(data.reviewExecution.diversity.status, "distinct", "3案の実質的な差を確認してください");
	assert.equal(data.reviewExecution.independence, "verified", "独立した審査実行を確認してください");
}

export function resolveDraftOutline(data) {
	assertReadyForApproval(data);
	assert.equal(data.approval.status, "approved", "ユーザーの構成承認が必要です");
	validateReply(data.approval, data);
	return { brief: data.brief, approvedOutline: data.approvedOutline };
}
