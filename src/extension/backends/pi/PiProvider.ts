// Pi共通処理とprovider固有実装の境界。SDKイベントと公開用の設定だけを扱う。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
	ConfigChoice,
	ConfigOption,
	QuotaWindow,
} from "../../../shared/composer";
import type { PiProviderControls } from "../../../shared/piProviderControls";

/** Provider固有の設定・候補・要求変換をひとまとまりで扱う。 */
export type PiModelControls = {
	bind: (session: AgentSession) => void;
	reset: () => void;
	snapshot: () => PiProviderControls;
	readonly reasoningOptions: ConfigChoice[];
	readonly configOptions: ConfigOption[];
	selectReasoning: (value: string, signal: AbortSignal) => void;
	configure: (id: string, value: string, signal: AbortSignal) => boolean;
	rewrite: (payload: unknown, model: AgentSession["model"]) => unknown;
};

/** 利用枠を取得できないproviderは実装自体を持たなくてよい。 */
export type PiQuotaReader = {
	read: (signal: AbortSignal) => Promise<QuotaWindow[] | null>;
};

/** Sessionごとに設定を生成し、利用枠サービスは必要なproviderだけ登録する。 */
export type PiProvider = {
	createControls?: () => PiModelControls;
	createQuota?: (
		models: ModelRuntime,
		session: AgentSession,
		request: typeof fetch,
	) => PiQuotaReader;
};

/** 未登録providerはPi SDKの標準機能だけで動作する。 */
export type PiProviders = Readonly<Record<string, PiProvider>>;
