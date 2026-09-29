// 選択ブランチの発言と圧縮済み要約を、モデル向けの参照資料へ変換する。
import type * as PiSdk from "@earendil-works/pi-coding-agent";

/** 最新の圧縮要約と保持範囲を使い、圧縮前の会話を再展開しない。 */
export function handoffEntries(
	branch: PiSdk.SessionEntry[],
): PiSdk.SessionEntry[] {
	let index = branch.length - 1;
	while (index >= 0 && branch[index]?.type !== "compaction") {
		index--;
	}
	if (index < 0) {
		return branch;
	}
	const compaction = branch[index]!;
	if (compaction.type !== "compaction") {
		return branch;
	}
	const first = branch.findIndex(
		(entry) => entry.id === compaction.firstKeptEntryId,
	);
	return [
		compaction,
		...(first >= 0 && first < index ? branch.slice(first, index) : []),
		...branch.slice(index + 1),
	];
}

/** 原文は発言だけ、引き継ぎは圧縮要約とツール結果も含む文字列にする。 */
export function piSessionContext(
	sdk: typeof PiSdk,
	branch: PiSdk.SessionEntry[],
	mode: "transcript" | "handoff",
): string {
	if (mode === "transcript") {
		const text = branch
			.flatMap((entry) => {
				if (
					entry.type !== "message" ||
					!["user", "assistant"].includes(entry.message.role)
				) {
					return [];
				}
				const message = entry.message;
				if (!("content" in message)) {
					return [];
				}
				const content =
					typeof message.content === "string"
						? message.content
						: message.content
								.filter((item) => item.type === "text")
								.map((item) => item.text)
								.join("\n");
				return [`${message.role}:\n${content}`];
			})
			.join("\n\n");
		if (!text.trim()) {
			throw new Error("参照できる発言がありません。");
		}
		return text.length > 40_000
			? `[Earlier content omitted; latest 40,000 characters follow]\n${text.slice(-40_000)}`
			: text;
	}
	const messages: Parameters<typeof sdk.convertToLlm>[0] = [];
	for (const entry of handoffEntries(branch)) {
		if (entry.type === "message") {
			messages.push(entry.message);
		}
		if (entry.type === "compaction") {
			messages.push({
				role: "compactionSummary",
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				timestamp: new Date(entry.timestamp).getTime(),
			});
		}
	}
	const text = sdk.serializeConversation(sdk.convertToLlm(messages));
	if (!text.trim()) {
		throw new Error("引き継ぐ会話がありません。");
	}
	return text;
}
