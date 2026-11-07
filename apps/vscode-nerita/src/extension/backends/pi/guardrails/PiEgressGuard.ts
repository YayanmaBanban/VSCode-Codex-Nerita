// 送信入力の固定コピーを検査し、個人情報の検出時だけ自動レビューを経由しない1回限りの承認を求める。
import { createHmac, randomBytes } from "node:crypto";
import {
	privacyKindLabels,
	type PrivacyKind,
	type PrivacyConfig,
} from "@nerita/shared/guardrails/privacy";
import type { PiAuthorize } from "../PiApprovedTools";
import { abortableFeatureApproval } from "../PiFeatureSafety";
import { detectPrivacyPatterns } from "./PiPrivacyPatterns";
import { guardrailRegistry } from "../../../security/GuardrailRegistry";
import type { AgentAccessPolicy } from "../../../security/AgentAccessPolicy";
import type { PermissionPresentation } from "@nerita/shared/permission";
import { isRecord } from "@nerita/shared/validation";

/** 値や入力のフィールド名を保持しない検出結果。 */
type Detection = { field: number; kinds: PrivacyKind[] };
/** 適用済み設定と承認失効の世代を、同じ保存・適用経路から取得する。 */
type PrivacySnapshot = {
	config: PrivacyConfig;
	revision: string;
	signal: AbortSignal;
};
/** 制限を超える入力は未検査のまま通さず、モデルへ再作成を求める。 */
export class PiPrivacyError extends Error {
	readonly code = "PI_EGRESS_PRIVACY";
}

/** URL・フォームと JSON の代表的な符号化を、有限回だけローカルで展開する。 */
function decoded(value: string): string[] {
	const values = new Set([value.normalize("NFKC")]);
	let current = value;
	for (let round = 0; round < 2; round++) {
		current = current.replace(/\\u([\da-f]{4})/gi, (_match, hex: string) =>
			String.fromCharCode(parseInt(hex, 16)),
		);
		try {
			current = decodeURIComponent(current.replaceAll("+", " "));
		} catch {
			// 不正なパーセントエンコードでも、元の文字列の検査は省略しない。
		}
		values.add(current.normalize("NFKC"));
	}
	return [...values];
}

/** キーも送信データなので走査し、検出箇所は通し番号だけで通知する。 */
function inputStrings(
	value: unknown,
	result: string[] = [],
	depth = 0,
): string[] {
	if (depth > 16 || result.length > 2048) {
		throw new PiPrivacyError(
			"送信入力が複雑なため検査できません。入力を小さくして再作成してください。",
		);
	}
	if (typeof value === "string" || typeof value === "number") {
		result.push(String(value));
		return result;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			inputStrings(item, result, depth + 1);
		}
		return result;
	}
	if (isRecord(value)) {
		inputFields(value, result, depth);
	}
	return result;
}

/** 社員番号などは JSON のキーも判定に使い、数値型の番号も検査へ含める。 */
function inputFields(
	value: Record<string, unknown>,
	result: string[],
	depth: number,
) {
	for (const [key, item] of Object.entries(value)) {
		result.push(key);
		const scalar = typeof item === "string" || typeof item === "number";
		inputStrings(
			scalar ? `${key}: ${String(item)}` : item,
			result,
			depth + 1,
		);
	}
}

/** 正規化・URL/JSON 展開後の文字列を検査し、値を保持せず分類だけを返す。 */
function inspect(value: unknown): Detection[] {
	const result: Detection[] = [];
	for (const [field, text] of inputStrings(value).entries()) {
		const kinds = new Set<PrivacyKind>();
		for (const variant of decoded(text)) {
			for (const kind of detectPrivacyPatterns(variant)) {
				kinds.add(kind);
			}
		}
		if (kinds.size > 0) {
			result.push({ field, kinds: [...kinds] });
		}
	}
	return result;
}

/** URL のパス・クエリーは表示せず、ホスト名にも検出値があれば伏せる。 */
function destination(input: unknown): string {
	if (!isRecord(input) || typeof input.url !== "string") {
		return "拡張機能が決定（この確認の対象はツール引数）";
	}
	try {
		const url = new URL(input.url);
		return inspect(url.origin).length === 0
			? url.origin
			: "接続先に個人情報を検出（非表示）";
	} catch {
		return "接続先を表示できません";
	}
}

/** 検出値を承認 UI やログへ複製せず、経路と種類・件数だけを示す。 */
function presentation(
	input: unknown,
	source: string,
	detections: Detection[],
): PermissionPresentation {
	return {
		title: "個人情報を含む入力を今回だけ送信",
		fields: [
			{ id: "source", label: "送信経路", value: source, display: "text" },
			{
				id: "destination",
				label: "送信先",
				value: destination(input),
				display: "text",
			},
			{
				id: "detection",
				label: "検出",
				value: detections
					.slice(0, 20)
					.map(
						(item) =>
							`項目 ${item.field + 1}: ${item.kinds.map((kind) => privacyKindLabels[kind]).join("・")}`,
					)
					.join("\n"),
				display: "text",
			},
			{
				id: "count",
				label: "検出箇所",
				value: String(detections.length),
				display: "text",
			},
		],
	};
}

/** JSON 化による例外にも入力の一部を含めず、検査可能な固定コピーだけを返す。 */
function snapshotInput(input: unknown) {
	try {
		const serialized = JSON.stringify(input);
		const invalid =
			typeof serialized !== "string" ||
			Buffer.byteLength(serialized, "utf8") > 65536;
		if (invalid) {
			throw new Error();
		}
		const snapshot: unknown = JSON.parse(serialized);
		return { serialized, snapshot };
	} catch {
		throw new PiPrivacyError(
			"送信入力は検査可能な64 KiB以内の JSON・テキストにしてください。",
		);
	}
}

/** 許可は送信コールバックの1回の実行に限り、再利用可能なトークンを外へ返さない。 */
export class PiEgressGuard {
	private readonly key = randomBytes(32);
	/** 文書の下書きではなく、適用済みガードレールのスナップショットを返すこと。 */
	constructor(private readonly snapshot: () => PrivacySnapshot) {}
	/** 入力の変更、設定の変更、取消し、承認待ちの期限切れでは送信しない。 */
	async run<T>(
		input: unknown,
		source: "Web ツール" | "Web 検索" | "MCP HTTP",
		authorize: PiAuthorize,
		signal: AbortSignal,
		send: (snapshot: unknown, signal: AbortSignal) => Promise<T>,
		prepare?: () => Promise<unknown>,
	): Promise<T> {
		signal.throwIfAborted();
		const initial = this.read();
		let combined = AbortSignal.any([signal, initial.signal]);
		combined.throwIfAborted();
		if (!initial.config.enabled) {
			return send(input, combined);
		}
		const { serialized, snapshot } = snapshotInput(
			prepare ? await prepare() : input,
		);
		combined.throwIfAborted();
		const detections = inspect(snapshot);
		// 検索対象のサイトは検索サービスへの送信先ではない。宛先を確定できない例外を発行しない。
		if (source === "Web 検索" && detections.length > 0) {
			throw new PiPrivacyError(
				"検索サービスの送信先を確定できないため、個人情報を除いて検索語を再作成してください。",
			);
		}
		const fingerprint = this.fingerprint(serialized, initial.revision);
		if (detections.length > 0) {
			combined = AbortSignal.any([combined, AbortSignal.timeout(60000)]);
			const permission = await this.consent(
				presentation(snapshot, source, detections),
				authorize,
				combined,
			);
			combined = AbortSignal.any([combined, permission]);
		}
		const current = this.read();
		combined.throwIfAborted();
		const changed =
			current.revision !== initial.revision ||
			fingerprint !==
				this.fingerprint(JSON.stringify(snapshot), current.revision);
		if (changed) {
			throw new PiPrivacyError(
				"送信入力または保護設定が変更されました。もう一度実行してください。",
			);
		}
		// この照合と送信コールバックの呼出しの間で待機しない。承認された固定コピーだけを実際の経路へ渡す。
		return send(snapshot, combined);
	}
	/** 送信を開始する前の拒否は、遠隔側の実行結果不明と区別できるエラーで返す。 */
	private async consent(
		request: PermissionPresentation,
		authorize: PiAuthorize,
		signal: AbortSignal,
	) {
		try {
			return await abortableFeatureApproval(
				authorize(request, signal),
				signal,
			);
		} catch {
			throw new PiPrivacyError(
				"個人情報を含む入力の送信は許可されませんでした。保護対象を除いて再作成してください。",
			);
		}
	}
	/** 復元失敗や適用世代の失効では、未検査のまま送信しない。 */
	private read() {
		try {
			const snapshot = this.snapshot();
			snapshot.signal.throwIfAborted();
			return snapshot;
		} catch {
			throw new PiPrivacyError(
				"個人情報の保護設定を取得できないため、送信を停止しました。",
			);
		}
	}
	/** 個人情報から単純なハッシュを作ってログへ残さない。秘密鍵も Host のメモリー内だけに保持する。 */
	private fingerprint(input: string, revision: string) {
		return createHmac("sha256", this.key)
			.update(revision)
			.update("\0")
			.update(input)
			.digest("hex");
	}
}

/** 子の作業フォルダでも、親のガードレール適用ルートを維持する。 */
export function createPiEgressGuard(cwd: string, policy: AgentAccessPolicy) {
	return new PiEgressGuard(() => {
		const active = guardrailRegistry.snapshot(
			policy.guardrailsRoot ?? cwd,
			policy.workspaceRoots,
		);
		return {
			config: active.config.privacy,
			revision: active.digest,
			signal: active.signal,
		};
	});
}
