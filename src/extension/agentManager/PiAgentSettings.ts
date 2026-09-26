// Pi の定義と設定を表示用に読み、優先順位の再実装を管理画面へ持ち込まない。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import { loadSubagentDefinitions } from "../backends/pi/PiSubagentDefinitions";
import {
	agentEditSchema,
	piDefaultsSchema,
} from "../../shared/agentManager/config";
import type { ManagedAgent } from "../../shared/agentManager/messages";

const settingsSchema = z.object({
	subagents: z
		.object({
			...piDefaultsSchema.shape,
			agentOverrides: z
				.record(
					z.string(),
					z.object({
						model: agentEditSchema.shape.model,
						thinking: agentEditSchema.shape.thinking,
						disabled: agentEditSchema.shape.disabled,
					}),
				)
				.optional(),
			modelScope: z.unknown().optional(),
		})
		.optional(),
});

/** 構造を検証するが、継承値や実効モデルは生成しない。 */
export function piSettings(text: string | undefined) {
	return (
		settingsSchema.parse(text === undefined ? {} : JSON.parse(text))
			.subagents ?? {}
	);
}

/** パッケージのコードを起動せず、既存の定義ローダーを使う。 */
export async function readPiAgents(
	extensionPath: string,
	root: string,
	trusted: boolean,
	projectText: string | undefined,
) {
	const sdk = (await import(
		pathToFileURL(join(extensionPath, "dist/runtime/pi.mjs")).href
	)) as typeof PiSdk;
	const agentDir = sdk.getAgentDir();
	const settings = sdk.SettingsManager.create(root, agentDir);
	settings.setProjectTrusted(trusted);
	const errors = settings.drainErrors();
	if (errors.length) {
		throw new Error(
			"Pi の設定ファイルを読み込めません。設定の形式を確認してください。",
		);
	}
	const definitions = await loadSubagentDefinitions(
		sdk,
		root,
		agentDir,
		settings,
		[],
	);
	const project = piSettings(projectText);
	const user = piSettings(JSON.stringify(settings.getGlobalSettings()));
	const agents = new Map<string, ManagedAgent>();
	for (const definition of definitions.definitions) {
		agents.set(definition.name, {
			id: `pi:${definition.name}`,
			backend: "pi",
			name: definition.name,
			description: definition.description,
			source: definition.source,
			aliases: definition.aliases ?? [],
			tools: definition.tools ?? [],
			definitionModel: definition.model,
			definitionThinking: definition.thinking,
			edit: agentEditSchema.parse(
				project.agentOverrides?.[definition.name] ?? {},
			),
			editable: true,
			unavailableReason: definition.unavailableReason,
		});
	}
	return {
		agents: [...agents.values()],
		defaults: piDefaultsSchema.parse(
			Object.fromEntries(
				Object.keys(piDefaultsSchema.shape).map((key) => [
					key,
					project[key as keyof typeof project],
				]),
			),
		),
		userSettings: JSON.stringify(user, null, 2),
		modelScope: JSON.stringify(
			{
				user: user.modelScope ?? null,
				project: project.modelScope ?? null,
			},
			null,
			2,
		),
		fingerprint: JSON.stringify({
			definitions: definitions.definitions,
			user,
		}),
	};
}
