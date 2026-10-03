// コンテキスト選択を開く入口。選択処理はピッカー側へ委ねる。
import { cn } from "cnfast";
import { Plus } from "lucide-react";
import { SettingsTooltip } from "../SettingsTooltip";

/** 本文の選択位置を維持して共通ピッカーを開く。 */
export function ContextPickerTrigger({
	disabled,
	onOpen,
}: {
	disabled: boolean;
	onOpen?: (() => void) | undefined;
}) {
	return (
		<SettingsTooltip content="コンテキストを追加">
			<button
				type="button"
				className={cn(
					"attach-button flex rounded-[5px] border-0 bg-transparent p-[5px]",
					"enabled:hover:bg-settings-hover",
				)}
				aria-label="コンテキストを追加"
				aria-haspopup="listbox"
				disabled={disabled || !onOpen}
				onMouseDown={(event) => event.preventDefault()}
				onClick={onOpen}
			>
				<Plus size={16} aria-hidden="true" />
			</button>
		</SettingsTooltip>
	);
}
