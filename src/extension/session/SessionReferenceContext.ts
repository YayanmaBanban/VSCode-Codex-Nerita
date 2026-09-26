// 参照方法ごとに履歴を読み、現在の会話へ渡す非信頼コンテキストを作る。
import {
	validSessionReferences,
	type SessionContextReference,
} from "../../shared/sessionReferences";
import { generateHandoff, type HandoffGenerator } from "./HandoffContext";

/** 読み込みと要約生成を分離し、両バックエンドで件数と参照先を検証する。 */
export async function buildSessionReferenceContext(options: {
	references: SessionContextReference[];
	currentId: string;
	cwd: string;
	backend: "pi" | "codex";
	model: string;
	goal: string;
	signal: AbortSignal;
	check: () => void;
	read: (reference: SessionContextReference) => Promise<string>;
	generate: HandoffGenerator;
}) {
	const { references, currentId, check, signal } = options;
	if (
		!validSessionReferences(references) ||
		references.some((ref) => ref.sessionId === currentId)
	) {
		throw new Error(
			"参照は現在の会話以外から、原文とハンドオフを合わせて5件まで選んでください。",
		);
	}
	const context: Record<string, { kind: "untrusted"; value: string }> = {};
	for (const ref of new Map(
		references.map((ref) => [
			JSON.stringify([ref.sessionId, ref.mode]),
			ref,
		]),
	).values()) {
		signal.throwIfAborted();
		check();
		const source = await options.read(ref);
		signal.throwIfAborted();
		check();
		const value =
			ref.mode === "handoff"
				? await generateHandoff(
						options.cwd,
						options.backend,
						options.model,
						options.goal,
						source,
						options.generate,
						signal,
					)
				: source;
		signal.throwIfAborted();
		check();
		context[
			`referenced_${ref.mode === "handoff" ? "handoff" : "session"}:${ref.sessionId}`
		] = { kind: "untrusted", value };
	}
	return context;
}
