// オプションからバックエンドの保存済み設定を選択する。
import { Cpu } from "lucide-react";
import type { BackendId } from "@nerita/shared/backend";
import { SelectionSubmenu } from "./SelectionSubmenu";

/** ホバー待機とキーボード操作を同じサブメニューで扱う。 */
export function BackendMenu({
	backend,
	onSelect,
}: {
	backend: BackendId | undefined;
	onSelect: (value: BackendId) => void;
}) {
	return (
		<SelectionSubmenu<BackendId>
			label="バックエンド"
			icon={<Cpu size={16} aria-hidden="true" />}
			value={backend}
			options={[
				["codex", "Codex"],
				["pi", "Pi"],
			]}
			onSelect={onSelect}
			disabled={backend === undefined}
		/>
	);
}
