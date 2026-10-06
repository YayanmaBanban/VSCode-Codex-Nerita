// オプションからサイドバーの配置を選択する。
import { Columns2 } from "lucide-react";
import type { SidebarLocation } from "@nerita/shared/sidebar";
import { SelectionSubmenu } from "./SelectionSubmenu";

/** ホバー待機とキーボード操作を同じサブメニューで扱う。 */
export function SidebarMenu({
	location,
	onSelect,
}: {
	location: SidebarLocation;
	onSelect: (value: SidebarLocation) => void;
}) {
	return (
		<SelectionSubmenu<SidebarLocation>
			label="サイドバー"
			icon={<Columns2 size={16} aria-hidden="true" />}
			value={location}
			options={[
				["primary", "プライマリ"],
				["secondary", "セカンダリ"],
			]}
			onSelect={onSelect}
		/>
	);
}
