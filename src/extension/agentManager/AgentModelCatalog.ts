// チャットの接続先を切り替えず、設定管理に必要なモデル能力だけを取得する。
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import type { ManagerModel } from "../../shared/agentManager/messages";
import { CodexClient } from "../backends/codex/CodexClient";
import { parseModels } from "../backends/codex/protocol/account";
import { piAgentModel } from "../backends/pi/PiAgentModels";
import { piProviders } from "../backends/pi/PiProviders";

export type AgentModelReader = (
	backend: "pi" | "codex",
	signal: AbortSignal,
) => Promise<ManagerModel[]>;

/** 会話・Tool・外部 Extension を起動せず、カタログだけを読む。 */
export function agentModelReader(
	extensionPath: string,
	cwd: string,
): AgentModelReader {
	return (backend, signal) =>
		backend === "pi"
			? readPi(extensionPath, signal)
			: readCodex(extensionPath, cwd, signal);
}

/** 管理画面専用の短命接続では thread/start を呼ばない。 */
async function readCodex(
	extensionPath: string,
	cwd: string,
	caller: AbortSignal,
): Promise<ManagerModel[]> {
	const signal = AbortSignal.any([caller, AbortSignal.timeout(20000)]);
	const client = await CodexClient.connect({
		extensionPath,
		cwd,
		signal,
		clientInfo: {
			name: "nerita_agent_manager",
			title: "Nerita Agent Manager",
			version: "0.0.1",
		},
	});
	try {
		const models: ManagerModel[] = [];
		const seen = new Set<string>();
		let cursor: string | undefined;
		do {
			signal.throwIfAborted();
			const page = parseModels(await client.listModels(cursor));
			models.push(
				...page.data.map((model) => ({
					value: model.model,
					name: model.displayName,
					efforts: model.supportedReasoningEfforts.map(
						(item) => item.reasoningEffort,
					),
				})),
			);
			cursor = page.nextCursor ?? undefined;
			if (cursor && seen.has(cursor)) {
				throw new Error("モデル一覧のページが循環しています。");
			}
			if (cursor) {
				seen.add(cursor);
			}
		} while (cursor);
		return models;
	} finally {
		await client.dispose();
	}
}

/** Pi の保存済み認証・モデル設定を使い、プロンプトやツールをロードしない。 */
async function readPi(
	extensionPath: string,
	caller: AbortSignal,
): Promise<ManagerModel[]> {
	const signal = AbortSignal.any([caller, AbortSignal.timeout(20000)]);
	const sdk = (await import(
		pathToFileURL(join(extensionPath, "dist/runtime/pi.mjs")).href
	)) as typeof PiSdk & {
		getSupportedThinkingLevels(
			model: NonNullable<PiSdk.AgentSession["model"]>,
		): string[];
	};
	const agentDir = sdk.getAgentDir();
	const runtime = await sdk.ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		modelsStorePath: join(agentDir, "models-store.json"),
		allowModelNetwork: true,
		modelRefreshTimeoutMs: 15000,
		signal,
	});
	const models = await runtime.getAvailable(undefined, { signal });
	const providers = [...new Set(models.map((model) => model.provider))];
	const catalogs = new Map(
		await Promise.all(
			providers.map(async (provider) => {
				const reader = piProviders[provider]?.createCatalog?.(
					runtime,
					fetch,
				);
				return [provider, await reader?.read(signal)] as const;
			}),
		),
	);
	signal.throwIfAborted();
	return models.flatMap((model) => {
		const catalog = catalogs.get(model.provider);
		const metadata = catalog?.find((item) => item.slug === model.id);
		if (catalog && metadata?.visibility !== "list") {
			return [];
		}
		return [
			piAgentModel(
				model,
				sdk.getSupportedThinkingLevels(model),
				metadata,
			),
		];
	});
}
