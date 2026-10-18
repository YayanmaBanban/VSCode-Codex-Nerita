// 保存した個別設定と既定値を定義へ反映し、子エージェントの推論レベルを制限する。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { isRecord } from "@nerita/shared/validation";
import {
	piSubagentSettingsSchema,
	piThinkingSchema,
} from "@nerita/shared/agentManager/config";
import {
	loadSubagentDefinitions,
	type PiSubagentDefinition,
} from "./PiSubagentDefinitions";
import type { PiThinkingLevel } from "@nerita/shared/piProviderControls";

/** モデル指定の末尾に含まれる通常推論だけを取り出す。 */
export function modelThinking(model: string | undefined) {
	const parsed = piThinkingSchema.safeParse(model?.split(":").at(-1));
	return parsed.success ? parsed.data : undefined;
}

/** 個別設定、定義、共通の既定値の順で解決し、無効化されたエージェントは直接指定でも起動させない。 */
function applySettings(
	definition: PiSubagentDefinition,
	settings: ReturnType<typeof piSubagentSettingsSchema.parse>,
) {
	const override = settings.agentOverrides?.[definition.name];
	const model = override?.model ?? definition.model ?? settings.defaultModel;
	const inheritedThinking = definitionThinking(definition, model, settings);
	const thinking = override?.thinking ?? inheritedThinking;
	const disabled = override?.disabled === true;
	return {
		...definition,
		model,
		thinking,
		...(disabled
			? { unavailableReason: "このエージェントは無効になっています。" }
			: {}),
	};
}

/** 定義の推論、モデルの末尾指定、共通既定値の順で補完する。 */
function definitionThinking(
	definition: PiSubagentDefinition,
	model: string | undefined,
	settings: ReturnType<typeof piSubagentSettingsSchema.parse>,
) {
	return (
		definition.thinking ?? modelThinking(model) ?? settings.defaultThinking
	);
}

/** ユーザー設定を先に読み、信頼済みのプロジェクト設定を項目単位で優先する。 */
function subagentSettings(settings: PiSdk.SettingsManager) {
	const global: unknown = settings.getGlobalSettings();
	const project: unknown = settings.isProjectTrusted()
		? settings.getProjectSettings()
		: {};
	const user = piSubagentSettingsSchema.parse(
		isRecord(global) ? (global.subagents ?? {}) : {},
	);
	const workspace = piSubagentSettingsSchema.parse(
		isRecord(project) ? (project.subagents ?? {}) : {},
	);
	const agentOverrides = { ...user.agentOverrides };
	for (const [name, override] of Object.entries(
		workspace.agentOverrides ?? {},
	)) {
		agentOverrides[name] = { ...agentOverrides[name], ...override };
	}
	return { ...user, ...workspace, agentOverrides };
}

/** 毎回データだけを読み直す。新たな拡張コードはロードせず、接続時に許可した導入先だけを参照する。 */
export async function readPiSubagentConfiguration(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	trusted: boolean,
	extensionPaths: string[],
) {
	const manager = sdk.SettingsManager.create(cwd, agentDir);
	manager.setProjectTrusted(trusted);
	if (manager.drainErrors().length > 0) {
		throw new Error(
			"Pi のエージェント設定を読み込めません。設定ファイルを確認してください。",
		);
	}
	const settings = subagentSettings(manager);
	const loaded = await loadSubagentDefinitions(
		sdk,
		cwd,
		agentDir,
		manager,
		extensionPaths,
	);
	return {
		...loaded,
		settings,
		definitions: loaded.definitions.map((definition) =>
			applySettings(definition, settings),
		),
	};
}

/** SDK が選んだ既定推論も上限内へ収め、対応値がないモデルを起動しない。 */
export function limitPiThinking(
	session: PiSdk.AgentSession,
	maximum: PiThinkingLevel | undefined,
) {
	if (maximum === undefined) {
		return;
	}
	const order = piThinkingSchema.options;
	if (order.indexOf(session.thinkingLevel) <= order.indexOf(maximum)) {
		return;
	}
	const allowed = session
		.getAvailableThinkingLevels()
		.filter((level) => order.indexOf(level) <= order.indexOf(maximum));
	const level = allowed.at(-1);
	if (level === undefined) {
		throw new Error(
			"このモデルでは、指定した上限以下の推論レベルを使用できません。モデルか Max thinking を変更してください。",
		);
	}
	session.setThinkingLevel(level);
}
