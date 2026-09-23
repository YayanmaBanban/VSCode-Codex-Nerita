// Providerが公開したモデル能力のうち、選択UIと要求制御に必要な情報だけ保持する。
import type { PiThinkingLevel } from "../../../shared/piProviderControls";

/** noneはHostでoffへ変換し、未知の推論値は公開しない。 */
export type PiCatalogModel = {
	slug: string;
	displayName: string;
	priority: number;
	visibility: "list" | "hide" | "none";
	defaultReasoning: PiThinkingLevel | "ultra" | null;
	reasoningLevels: (PiThinkingLevel | "ultra")[];
	serviceTiers: { id: string; name: string; description: string }[];
};

/** undefinedはmetadata取得元なし、nullはlive能力未確認を表す。 */
export type PiCatalogSnapshot = readonly PiCatalogModel[] | null | undefined;

/** 認証・キャッシュキーを外へ出さず、正規化済みmetadataだけ返す。 */
export type PiModelCatalogReader = {
	read: (signal: AbortSignal) => Promise<readonly PiCatalogModel[] | null>;
};
