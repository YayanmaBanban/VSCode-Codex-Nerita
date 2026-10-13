// 同じ設定欄では1つのカードだけを開き、カード内の選択メニューは独立して操作する。
import { getContext, onDestroy, setContext } from "svelte";

const contextKey = Symbol("settings-popup");

/** 開いている設定カードの所有者を、設定欄の寿命に合わせて保持する。 */
export function provideSettingsPopupGroup() {
	const group = $state<{ active: symbol | null }>({ active: null });
	setContext(contextKey, group);
}

/** グループがない利用先では単独で開閉し、子メニューには排他制御を継承しない。 */
export function useSettingsPopup() {
	const group = getContext<{ active: symbol | null } | undefined>(contextKey);
	setContext(contextKey, undefined);
	const owner = Symbol("settings-popup-owner");
	let standaloneOpen = $state(false);

	onDestroy(() => {
		if (group?.active === owner) {
			group.active = null;
		}
	});

	return {
		get open() {
			return group ? group.active === owner : standaloneOpen;
		},
		set open(next: boolean) {
			if (!group) {
				standaloneOpen = next;
			} else if (next) {
				group.active = owner;
			} else if (group.active === owner) {
				group.active = null;
			}
		},
		/** 別カードへ切り替えたときは、閉じたカードへフォーカスを戻さない。 */
		onCloseAutoFocus(this: void, event: Event) {
			if (group && group.active !== null && group.active !== owner) {
				event.preventDefault();
			}
		},
	};
}
