// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import {
	type GuardrailsConfig,
	type PathRule,
} from "@nerita/shared/guardrails/config";

/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const inputStyle =
	"box-border w-full min-w-0 rounded border border-input-border bg-input px-2 py-1.5 text-input-text hover:border-focus focus:outline-2 focus:outline-focus";
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const buttonStyle =
	"rounded border border-panel-border bg-input px-3 py-1.5 text-input-text hover:border-focus focus:outline-2 focus:outline-focus disabled:opacity-50";
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export function ruleBackground(index: number): string {
	const hue = (210 + index * 137.508) % 360;
	return `color-mix(in srgb, hsl(${hue} 45% 60%) 12%, var(--nerita-editor-background))`;
}
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type ActionProps = {
	label: string;
	className?: string;
	value: "allow" | "ask" | "deny";
	onChange: (value: "allow" | "ask" | "deny") => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type GuardrailsRulesProps = {
	config: GuardrailsConfig;
	onChange: (config: GuardrailsConfig) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type CommandRuleGroupProps = {
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
	nextId: (prefix: string) => string;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PathRuleGroupProps = {
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
	nextId: (prefix: string) => string;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type CommandRuleCardProps = {
	index: number;
	rule: GuardrailsConfig["commandRules"][number];
	update: (patch: Partial<GuardrailsConfig["commandRules"][number]>) => void;
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type CommandRuleShellProps = {
	rule: GuardrailsConfig["commandRules"][number];
	update: (patch: Partial<GuardrailsConfig["commandRules"][number]>) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PathRuleCardProps = {
	index: number;
	rule: PathRule;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const pathRuleCardStyle = `
     guardrails-rule-card m-0 min-w-0 shrink-0 rounded border
     border-panel-border
   `;
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const pathRuleFieldsStyle = `
      grid grid-cols-1 gap-3
      sm:grid-cols-2
    `;
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PathRuleBaseProps = Pick<
	PathRuleCardProps,
	"rule" | "index" | "updatePath"
>;
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PathRuleMatchProps = PathRuleBaseProps;
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PathRuleOperationsProps = PathRuleBaseProps;
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PathRuleExceptionsProps = PathRuleBaseProps;
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PathRuleExceptionProps = {
	entry: number;
	exception: string;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
	index: number;
	rule: PathRule;
};
