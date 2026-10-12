// コンテキストの入口で使う表示と検索語をまとめる。
import Paperclip from "@lucide/svelte/icons/paperclip";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Component from "@lucide/svelte/icons/component";
import MessageSquareMore from "@lucide/svelte/icons/message-square-more";
import MoveUpRight from "@lucide/svelte/icons/move-up-right";
import Diff from "@lucide/svelte/icons/diff";

/** ボタンと本文補完で共有するカテゴリ。 */
export const contextCategories = [
	{
		label: "添付ファイル",
		description: "画像やファイルを追加",
		icon: Paperclip,
		keywords: "attachment image file",
	},
	{
		label: "ファイルとディレクトリ",
		description: "ワークスペースから参照",
		icon: FolderOpen,
		keywords: "file directory folder workspace",
	},
	{
		label: "シンボル",
		description: "関数・クラス・型を参照",
		icon: Component,
		keywords: "symbol function class type",
	},
	{
		label: "セッション",
		description: "過去の会話を参照",
		icon: MessageSquareMore,
		keywords: "session conversation",
	},
	{
		label: "ハンドオフ",
		description: "セッション内容を要約し引き継ぐ",
		icon: MoveUpRight,
		keywords: "handoff session",
	},
	{
		label: "Git の変更",
		description: "現在のDiffをコンテキストに追加",
		icon: Diff,
		keywords: "git diff changes",
	},
];
