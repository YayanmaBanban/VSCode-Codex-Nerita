// 組み込みprovider固有機能の登録一覧。共通処理にprovider名の分岐を追加しない。
import type { PiProviders } from "./PiProvider";
import { CodexProviderControls } from "./codex/CodexProviderControls";
import { CodexQuotaService } from "./codex/CodexQuotaService";
import { codexQuotaGroup } from "./codex/CodexQuotaGroup";

export const piProviders: PiProviders = {
	"openai-codex": {
		quotaGroup: codexQuotaGroup,
		createControls: () => new CodexProviderControls(),
		createQuota: (models, session, request) =>
			new CodexQuotaService(models, session, request),
	},
};
