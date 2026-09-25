// Pi 共通処理とプロバイダー固有実装の境界。SDK イベントと公開用の設定だけを扱う。
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
import type { PiCatalogSnapshot, PiModelCatalogReader } from "./PiModelCatalog";

/** プロバイダー固有の設定・候補・要求変換をひとまとまりで扱う。 */
export type PiModelControls = {
	bind: (session: AgentSession) => void;
	setCatalog?: (catalog: PiCatalogSnapshot) => void;
	reset: () => void;
	snapshot: () => PiProviderControls;
	readonly reasoningOptions: ConfigChoice[];
	readonly configOptions: ConfigOption[];
	selectReasoning: (value: string, signal: AbortSignal) => void;
	configure: (id: string, value: string, signal: AbortSignal) => boolean;
	rewrite: (payload: unknown, model: AgentSession["model"]) => unknown;
};

/** 利用枠を取得できないプロバイダーは実装自体を持たなくてよい。 */
export type PiQuotaReader = {
	read: (signal: AbortSignal) => Promise<QuotaWindow[] | null>;
};

/** Session ごとに設定を生成し、利用枠サービスは必要なプロバイダーだけ登録する。 */
export type PiProvider = {
	/** モデル選択とは独立した補助メタデータの取得元。 */
	createCatalog?: (
		models: ModelRuntime,
		request: typeof fetch,
	) => PiModelCatalogReader;
	/** 同じ文字列を返すモデル間では利用枠表示を維持する。未定義はモデル単位。 */
	quotaGroup?: (modelId: string) => string;
	createControls?: () => PiModelControls;
	createQuota?: (
		models: ModelRuntime,
		session: AgentSession,
		request: typeof fetch,
	) => PiQuotaReader;
};

/** 未登録プロバイダーは Pi SDK の標準機能だけで動作する。 */
export type PiProviders = Readonly<Record<string, PiProvider>>;
