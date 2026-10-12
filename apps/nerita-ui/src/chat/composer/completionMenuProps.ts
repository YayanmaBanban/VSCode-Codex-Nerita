import type { Snippet } from "svelte";
import type { CompletionItem } from "./completionItems";
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
