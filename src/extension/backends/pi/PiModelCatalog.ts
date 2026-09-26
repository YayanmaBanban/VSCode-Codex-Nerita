// プロバイダーが公開したモデル能力のうち、選択 UI と要求制御に必要な情報だけ保持する。
import type { PiThinkingLevel } from "../../../shared/piProviderControls";

/** `none` は Host で `off` へ変換し、未知の推論値は公開しない。 */
export type PiCatalogModel = {
	slug: string;
	displayName: string;
	priority: number;
	visibility: "list" | "hide" | "none";
	defaultReasoning: PiThinkingLevel | "ultra" | null;
	reasoningLevels: (PiThinkingLevel | "ultra")[];
	serviceTiers: { id: string; name: string; description: string }[];
	/** 更新項目を受理する能力。指定した推論レベルへの反映が正常かは別途検証する。 */
	supportsReasoningEffortUpdates?: boolean;
};

/** `undefined` はメタデータ取得元なし、`null` はカタログの能力が未確認の状態を表す。 */
export type PiCatalogSnapshot = readonly PiCatalogModel[] | null | undefined;

/** 認証・キャッシュキーを外へ出さず、正規化済みメタデータだけ返す。 */
export type PiModelCatalogReader = {
	read: (signal: AbortSignal) => Promise<readonly PiCatalogModel[] | null>;
};
