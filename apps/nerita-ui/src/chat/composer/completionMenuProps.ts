// 補完候補とコンテキスト選択で共有する、メニューの表示・選択・操作の契約を定義する。
import type { Snippet } from "svelte";
import type { CompletionItem } from "./completionItems";
/** 補完メニューの表示と操作の契約。候補の取得と選択の確定は呼び出し元が担当する。 */
export type CompletionMenuProps = {
	id: string;
	title: string;
	query: string;
	items: CompletionItem[];
	selected: number;
	empty: string;
	onQuery: (text: string) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	onPick: (item: CompletionItem) => void;
	location?: string | undefined;
	notice?: string | undefined;
	header?: Snippet;
	context?: boolean;
	autoFocus?: boolean;
};
