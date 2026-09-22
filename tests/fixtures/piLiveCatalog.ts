// Storyと回帰テスト用の公開済みcatalog。実通信・実アカウントは使用しない。
import type { PiCatalogModel } from "../../src/extension/backends/pi/PiModelCatalog";

export const piLiveCatalog: PiCatalogModel[] = [
	{
		slug: "hidden",
		displayName: "Hidden Codex",
		priority: 3,
		visibility: "hide",
		defaultReasoning: "high",
		reasoningLevels: ["low", "high"],
		serviceTiers: [],
	},
	{
		slug: "max-model",
		displayName: "GPT-6-Astra",
		priority: 0,
		visibility: "list",
		defaultReasoning: "high",
		reasoningLevels: ["low", "high", "max", "ultra"],
		serviceTiers: [
			{
				id: "priority",
				name: "Fast",
				description: "優先処理を使用します。",
			},
		],
	},
	{
		slug: "another-max-model",
		displayName: "Another",
		priority: 1,
		visibility: "list",
		defaultReasoning: "high",
		reasoningLevels: ["low", "high", "max", "ultra"],
		serviceTiers: [
			{ id: "priority", name: "Fast", description: "優先処理" },
		],
	},
	{
		slug: "small",
		displayName: "Codex Small",
		priority: 2,
		visibility: "list",
		defaultReasoning: "high",
		reasoningLevels: ["off", "minimal", "low", "high"],
		serviceTiers: [],
	},
];
