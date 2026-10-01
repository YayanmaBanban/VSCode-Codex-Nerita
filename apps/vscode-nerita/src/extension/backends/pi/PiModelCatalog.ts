// プロバイダーが公開したモデル能力のうち、選択 UI と要求制御に必要な情報だけ保持する。
import type { PiThinkingLevel } from "@nerita/shared/piProviderControls";

/** 通常推論の候補は SDK に任せ、ライブカタログで確認した Ultra の実推論値だけ補う。 */
export type PiCatalogModel = {
	slug: string;
	displayName: string;
	priority: number;
	visibility: "list" | "hide" | "none";
	ultraEffort?: PiThinkingLevel;
	fastMode?: boolean;
};

/** `undefined` はメタデータ取得元なし、`null` はカタログの能力が未確認の状態を表す。 */
export type PiCatalogSnapshot = readonly PiCatalogModel[] | null | undefined;

/** 認証・キャッシュキーを外へ出さず、正規化済みメタデータだけ返す。 */
export type PiModelCatalogReader = {
	read: (signal: AbortSignal) => Promise<readonly PiCatalogModel[] | null>;
};
