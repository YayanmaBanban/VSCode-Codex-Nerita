// コンテキストの入口で使う表示と検索語をまとめる。
import {
	Paperclip,
	FolderOpen,
	Component,
	MessageSquareMore,
	MoveUpRight,
	Diff,
} from "lucide-react";

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
