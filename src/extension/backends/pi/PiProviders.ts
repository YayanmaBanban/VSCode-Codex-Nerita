// 組み込みプロバイダー固有機能の登録一覧。共通処理にプロバイダー名の分岐を追加しない。
import type { PiProviders } from "./PiProvider";
import { CodexProviderControls } from "./codex/CodexProviderControls";
import { CodexQuotaService } from "./codex/CodexQuotaService";
import { codexQuotaGroup } from "./codex/CodexQuotaGroup";
import { CodexModelCatalogService } from "./codex/CodexModelCatalogService";

export const piProviders: PiProviders = {
	"openai-codex": {
		createCatalog: (models, request) =>
			new CodexModelCatalogService(models, request),
		quotaGroup: codexQuotaGroup,
		createControls: () => new CodexProviderControls(),
		createQuota: (models, session, request) =>
			new CodexQuotaService(models, session, request),
	},
};
