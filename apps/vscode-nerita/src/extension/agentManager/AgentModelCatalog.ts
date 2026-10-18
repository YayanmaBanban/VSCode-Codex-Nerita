// チャットの接続先を切り替えず、設定管理に必要なモデル能力だけを取得する。
import { loadPiSdk } from "../backends/pi/PiSdk";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { join } from "node:path";
import type { ManagerModel } from "@nerita/shared/agentManager/messages";
import { CodexClient } from "../backends/codex/CodexClient";
import { parseModels } from "../backends/codex/protocol/account";
import { readPiAgentModels } from "../backends/pi/PiAgentModels";
import type { BackendId } from "@nerita/shared/backend";
import type { ChatState } from "@nerita/shared/chatState";
import {
	piEffortSchema,
	codexReasoningSchema,
} from "@nerita/shared/agentManager/config";
import {
	PiCredentialVault,
	PiCredentialStore,
} from "../credentials/PiCredentialStore";
import {
	CredentialStores,
	SessionMemoryCredentialStore,
} from "../credentials/CredentialStore";

/** バックエンド別のモデル取得処理。中断シグナルを尊重し、選択できるモデルと推論候補を返す。 */
export type AgentModelReader = (
	backend: "pi" | "codex",
	signal: AbortSignal,
) => Promise<ManagerModel[]>;

/** 会話・ツール・外部 Extension を起動せず、カタログだけを読む。 */
export function agentModelReader(
	extensionPath: string,
	cwd: string,
	credentials?: PiCredentialStore,
): AgentModelReader {
	return (backend, signal) =>
		backend === "pi"
			? readPi(extensionPath, signal, credentials)
			: readCodex(extensionPath, cwd, signal);
}

/** セッション自身の候補を使い、カタログにないモデル ID や別名でも現在の推論候補を保持する。 */
export function currentAgentModel(state: ChatState, backend: BackendId) {
	const model = state.configOptions.find(
		(option) => option.id === "model",
	)?.currentValue;
	const reasoning = state.configOptions.find(
		(option) => option.id === "reasoning_effort",
	);
	const schema = backend === "pi" ? piEffortSchema : codexReasoningSchema;
	const efforts = reasoning?.options
		.map((option) => option.value)
		.filter((value) => schema.safeParse(value).success);
	return {
		currentModels: { [backend]: model },
		currentEfforts: { [backend]: efforts },
	};
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
			if (isNonEmptyString(cursor) && seen.has(cursor)) {
				throw new Error("モデル一覧のページが循環しています。");
			}
			if (isNonEmptyString(cursor)) {
				seen.add(cursor);
			}
		} while (isNonEmptyString(cursor));
		return models;
	} finally {
		await client.dispose();
	}
}

/** Pi の保存済み認証・モデル設定を使い、プロンプトやツールをロードしない。 */
async function readPi(
	extensionPath: string,
	caller: AbortSignal,
	credentials?: PiCredentialStore,
): Promise<ManagerModel[]> {
	const signal = AbortSignal.any([caller, AbortSignal.timeout(20000)]);
	const sdk = await loadPiSdk(extensionPath);
	const agentDir = sdk.getAgentDir();
	const runtime = await sdk.ModelRuntime.create({
		credentials:
			credentials ??
			new PiCredentialStore(
				new PiCredentialVault(
					new CredentialStores(new SessionMemoryCredentialStore()),
					{ read: () => undefined, write: () => Promise.resolve() },
				),
			),
		modelsPath: join(agentDir, "models.json"),
		modelsStorePath: join(agentDir, "models-store.json"),
		allowModelNetwork: true,
		modelRefreshTimeoutMs: 15000,
		signal,
	});
	return readPiAgentModels(
		runtime,
		(model) => sdk.getSupportedThinkingLevels(model),
		signal,
	);
}
