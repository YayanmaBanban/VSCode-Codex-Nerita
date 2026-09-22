// Hostが解決した宣言型UIだけをWebviewへ渡す。実行コードや任意のCSSは含めない。
import type { BackendId } from "./backend";
import type { ConfigOption } from "./composer";

/** 初期版で配置できる表示領域。 */
export type NeritaUiSlot =
	| "settings.main"
	| "settings.advanced"
	| "model.header"
	| "composer.toolbar"
	| "status";

/** backendとproviderを独立に指定し、すべての条件をHostで照合する。 */
export type ContributionCondition = {
	backend?: BackendId;
	provider?: string;
	capability?: string;
};

/** 操作は既存の検証済みconfig/setへ接続する。 */
export type NeritaUiControl =
	| { type: "select"; option: ConfigOption; disabled?: boolean }
	| {
			type: "toggle";
			configId: string;
			label: string;
			checked: boolean;
			onValue: string;
			offValue: string;
			disabled?: boolean;
			description?: string;
	  }
	| { type: "progress"; label: string; value: number; description?: string };

/** Registryへの登録形式。条件そのものはWebviewへ送らない。 */
export type NeritaUiContribution = {
	id: string;
	slot: NeritaUiSlot;
	order?: number;
	when?: ContributionCondition;
	control: NeritaUiControl;
};

/** Hostで表示条件を解決した通信形式。 */
export type ResolvedUiContribution = Omit<NeritaUiContribution, "when">;

/** backend固有のSurfaceと、その内側に配置する宣言。 */
export type UiContributions = {
	surface: BackendId;
	items: ResolvedUiContribution[];
};
