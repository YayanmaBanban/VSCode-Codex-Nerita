// 組み込みプロバイダー固有機能の登録一覧。共通処理にプロバイダー名の分岐を追加しない。
import type { PiProviders } from "./PiProvider";
import { OpenAIProviderControls } from "./openai/OpenAIProviderControls";
import { OpenAIQuotaService } from "./openai/OpenAIQuotaService";
import { OpenAIModelCatalogService } from "./openai/OpenAIModelCatalogService";

export const piProviders: PiProviders = {
	openai: {
		createCatalog: (models, request) =>
			new OpenAIModelCatalogService(models, request),
		createControls: () => new OpenAIProviderControls(),
		createQuota: (models, session, request, codexQuota) =>
			new OpenAIQuotaService(models, session, request, codexQuota),
	},
};
