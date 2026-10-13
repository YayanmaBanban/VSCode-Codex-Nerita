// 文書編集と判定シミュレーションの入力型、および保存・適用状態の表示を共有する。

import {
	type GuardBridge,
	type GuardProbe,
} from "@nerita/shared/guardrails/messages";

import { type ZodSafeParseResult } from "zod";

import "../../chat/chat.css";

import "./guardrails.css";

import { type useGuardrails } from "./useGuardrails.svelte";
/** ガードレール文書の取得・編集・保存に使う通信窓口。 */
export type GuardrailsEditorProps = { bridge: GuardBridge };
/** 保存状態の表示と、現在の文書に対する保存・適用操作を渡す。 */
export type GuardrailsEditorHeaderProps = {
	editor: ReturnType<typeof useGuardrails>;
	state: NonNullable<ReturnType<typeof useGuardrails>["state"]>;
	status: string;
	probe: GuardProbe;
};
/** 検査対象の入力と、文書を実行せず判定結果を取得する操作を渡す。 */
export type GuardrailsProbePaneProps = {
	editor: ReturnType<typeof useGuardrails>;
	probe: GuardProbe;
	setProbe: (value: GuardProbe) => void;
};
/** 文書の編集状態と解析結果を渡し、フォームと JSON の編集を切り替える。 */
export type GuardrailsRulePaneProps = {
	tab: "form" | "json";
	setTab: (value: "form" | "json") => void;
	editor: ReturnType<typeof useGuardrails>;
	parsed:
		| ZodSafeParseResult<{
				version: 1;
				pathAccess: {
					outsideRead: "allow" | "ask" | "deny";
					outsideWrite: "deny";
				};
				pathRules: {
					base: "workspace" | "home";
					match: "glob" | "file" | "directory";
					action: "allow" | "ask" | "deny";
					id: string;
					reason: string;
					pattern: string;
					exceptions: string[];
					operations: ("read" | "write")[];
				}[];
				commandRules: {
					shell: "powershell" | "pwsh" | "bash" | "any";
					match: "contains";
					action: "allow" | "ask" | "deny";
					id: string;
					reason: string;
					pattern: string;
				}[];
		  }>
		| undefined;
};
/** 検査に使うツールと作業ディレクトリを、親が保持する入力へ反映する。 */
export type GuardrailsProbeTargetProps = {
	probe: GuardProbe;
	setProbe: (value: GuardProbe) => void;
};
/** 下書き・保存済み文書・適用済み設定を比較し、未保存または未適用の状態を返す。 */
export function documentStatus(
	text: string,
	state: { dirty: boolean; text: string; activeText: string },
): string {
	if (state.dirty || text !== state.text) {
		return "未保存";
	}
	try {
		return JSON.stringify(JSON.parse(text)) ===
			JSON.stringify(JSON.parse(state.activeText))
			? "適用済み"
			: "保存済み・未適用";
	} catch {
		return "保存済み・未適用";
	}
}
