// ルール編集欄の入力型と、カード・入力・ボタンの共通スタイルを定義する。

import {
	type GuardrailsConfig,
	type PathRule,
} from "@nerita/shared/guardrails/config";

/** ルール入力欄の枠・背景・フォーカス表示を揃える。 */
export const inputStyle =
	"box-border w-full min-w-0 rounded border border-input-border bg-input px-2 py-1.5 text-input-text hover:border-focus focus:outline-2 focus:outline-focus";
/** 操作ボタンの枠と、フォーカス・無効状態の表示を揃える。 */
export const buttonStyle =
	"rounded border border-panel-border bg-input px-3 py-1.5 text-primary-text hover:border-focus focus:outline-2 focus:outline-focus disabled:opacity-50";
/** 許可・承認・拒否の選択値と、親へ変更を伝える操作を渡す。 */
export type ActionProps = {
	label: string;
	className?: string;
	value: "allow" | "ask" | "deny";
	onChange: (value: "allow" | "ask" | "deny") => void;
};
/** ルール編集の設定全体を渡し、変更は親の文書へ反映する。 */
export type GuardrailsRulesProps = {
	onEditExceptions: () => void;
	selection: { path: number; command: number };
	locked: boolean;
	section: "overview" | "builtins" | "path" | "command" | "exceptions";
	config: GuardrailsConfig;
	onChange: (config: GuardrailsConfig) => void;
};
/** コマンドルールの一覧と、追加時に重複しない ID を作る操作を渡す。 */
export type CommandRuleGroupProps = {
	locked: boolean;
	selection: GuardrailsRulesProps["selection"];
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
	nextId: (prefix: string) => string;
};
/** パスルールの一覧と、追加・個別更新を親へ伝える操作を渡す。 */
export type PathRuleGroupProps = {
	onEditExceptions: () => void;
	selection: GuardrailsRulesProps["selection"];
	locked: boolean;
	exceptionsOnly?: boolean;
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
	nextId: (prefix: string) => string;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
};
/** 対象のコマンドルールと、項目の更新操作を渡す。 */
export type CommandRuleCardProps = {
	rule: GuardrailsConfig["commandRules"][number];
	update: (patch: Partial<GuardrailsConfig["commandRules"][number]>) => void;
};
/** コマンドルールの対象シェルと、選択を親へ反映する操作を渡す。 */
export type CommandRuleShellProps = {
	rule: GuardrailsConfig["commandRules"][number];
	update: (patch: Partial<GuardrailsConfig["commandRules"][number]>) => void;
};
/** 対象のパスルールと、項目の更新・例外の編集画面への移動に使う操作を渡す。 */
export type PathRuleCardProps = {
	onEditExceptions: () => void;
	index: number;
	rule: PathRule;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
};
/** パスルールのカードで共通の枠と配置を使う。 */
export const pathRuleCardStyle = `
     guardrails-rule-card m-0 min-w-0 shrink-0 rounded border
     border-panel-border
   `;
/** 対になる条件を2列に並べ、長い入力欄は利用側で全幅を使う。 */
export const pathRuleFieldsStyle = "grid grid-cols-2 gap-3";
/** パスルールの位置と内容を渡し、各項目の変更を親へ伝える。 */
export type PathRuleFieldProps = Pick<
	PathRuleCardProps,
	"rule" | "index" | "updatePath"
>;
/** パスルールの照合方式を編集するための値と更新操作。 */
export type PathRuleMatchProps = PathRuleFieldProps;
/** パスルールの読み取り・書き込み操作を選ぶための値と更新操作。 */
export type PathRuleOperationsProps = PathRuleFieldProps;
/** パスルールの例外一覧を追加・更新するための値と操作。 */
export type PathRuleExceptionsProps = PathRuleFieldProps;
/** 例外の位置と本文を渡し、対象のパスルール内で更新・削除する。 */
export type PathRuleExceptionProps = {
	entry: number;
	exception: string;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
	index: number;
	rule: PathRule;
};
