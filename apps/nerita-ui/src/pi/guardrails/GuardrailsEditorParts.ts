// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import {
	type GuardBridge,
	type GuardProbe,
} from "@nerita/shared/guardrails/messages";

import { type ZodSafeParseResult } from "zod";

import "../../chat/chat.css";

import "./guardrails.css";

import { type useGuardrails } from "./useGuardrails.svelte";
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type GuardrailsEditorProps = { bridge: GuardBridge };
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type GuardrailsEditorHeaderProps = {
	editor: ReturnType<typeof useGuardrails>;
	state: NonNullable<ReturnType<typeof useGuardrails>["state"]>;
	status: string;
	probe: GuardProbe;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type GuardrailsProbePaneProps = {
	editor: ReturnType<typeof useGuardrails>;
	probe: GuardProbe;
	setProbe: (value: GuardProbe) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
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
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type GuardrailsProbeTargetProps = {
	probe: GuardProbe;
	setProbe: (value: GuardProbe) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
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
