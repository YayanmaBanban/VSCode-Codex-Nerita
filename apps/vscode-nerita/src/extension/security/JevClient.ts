// Jev の公式 tool-guard API に接続する。認証 UI は呼出側で用意する。
import { z } from "zod";
import { jevDecisionSchema, type JevReviewer } from "./JevGuard";

const responseSchema = z.object({
	code: z.literal(0),
	data: jevDecisionSchema,
});
const endpoint = "https://www.jevai.org/api/v1/decisions/tool-guard";

/** 呼出側が認証情報と送信への同意を用意する。生成だけでは通信しない。 */
export function createJevReviewer(
	apiKey: string,
	transport: typeof fetch = fetch,
): JevReviewer {
	if (!apiKey.trim()) {
		throw new Error("JevのAPIキーが未設定です。");
	}
	return async (input, signal) => {
		const body = JSON.stringify(input);
		if (Buffer.byteLength(body, "utf8") > 32768) {
			throw new Error("Jevへの入力が上限を超えています。");
		}
		signal.throwIfAborted();
		const response = await transport(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body,
			signal,
			redirect: "error",
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error("Jevへの接続に失敗しました。");
		}
		return responseSchema.parse(JSON.parse(await boundedResponse(response)))
			.data;
	};
}

/** 外部応答のサイズを制限し、エラー本文や認証情報をログへ出さない。 */
async function boundedResponse(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("Jevからの応答が空です。");
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			const bytes: unknown = chunk.value;
			if (!(bytes instanceof Uint8Array)) {
				throw new Error("Jevの応答形式が不正です。");
			}
			size += bytes.length;
			if (size > 32768) {
				throw new Error("Jevの応答が上限を超えています。");
			}
			chunks.push(bytes);
		}
		return Buffer.concat(chunks).toString("utf8");
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}
