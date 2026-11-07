// MCP が実際に送信する Request の固定コピーを検査し、リダイレクトを許可しない。
import type { PiAuthorize } from "../PiApprovedTools";
import { PiPrivacyError, type PiEgressGuard } from "./PiEgressGuard";
import { abortableFeatureApproval } from "../PiFeatureSafety";

/** 保護が無効の場合は本文を検査せず、有効の場合は検査した同じ Request だけを送信する。 */
export function fetchPiMcpRequest(
	request: Request,
	authorize: PiAuthorize,
	signal: AbortSignal,
	guard?: PiEgressGuard,
	verify?: () => Promise<void>,
): Promise<Response> {
	if (!guard) {
		return fetch(request);
	}
	/** 追加承認の待機後も、接続設定と信頼を再確認してから同じ Request を送る。 */
	const send = async (_snapshot: unknown, allowed: AbortSignal) => {
		try {
			await verify?.();
			allowed.throwIfAborted();
		} catch {
			throw new PiPrivacyError(
				"MCP の送信条件が変更されたため、送信を停止しました。",
			);
		}
		return fetch(request, { signal: allowed });
	};
	return guard.run(
		undefined,
		"MCP HTTP",
		authorize,
		signal,
		send,
		async () => ({
			url: request.url,
			method: request.method,
			headers: [...request.headers],
			body: await inspectableBody(request),
		}),
	);
}

/** ストリームを際限なく読み込まず、送信前に固定した本文だけを検査する。 */
async function inspectableBody(request: Request): Promise<unknown> {
	if (request.body === null) {
		return "";
	}
	const contentType = request.headers.get("content-type") ?? "";
	const supported =
		/^(?:application\/(?:json|[^;]+\+json|x-www-form-urlencoded)|text\/[^;]+)(?:;|$)/i.test(
			contentType,
		);
	if (request.headers.has("content-encoding") || !supported) {
		throw new PiPrivacyError(
			"検査できない形式の MCP 本文は送信できません。",
		);
	}
	const reader: ReadableStreamDefaultReader<Uint8Array> = request
		.clone()
		.body!.getReader();
	const parts: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await abortableFeatureApproval(
				reader.read(),
				request.signal,
			);
			if (done) {
				break;
			}
			size += value.byteLength;
			if (size > 65536) {
				throw new PiPrivacyError(
					"MCP 本文は64 KiB以内にしてください。",
				);
			}
			parts.push(value);
		}
		const text = new TextDecoder("utf-8", { fatal: true }).decode(
			Buffer.concat(parts),
		);
		if (/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(contentType)) {
			try {
				const json: unknown = JSON.parse(text);
				return json;
			} catch {
				throw new PiPrivacyError("MCP の JSON 本文を検査できません。");
			}
		}
		return text;
	} finally {
		void reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
