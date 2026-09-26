// 入力欄と送信済みメッセージで参照のアイコンとラベルを揃える。
import { Braces, Folder, MessageSquare, GitCompare } from "lucide-react";
import type { ComposerTarget } from "../../../shared/composerTargets";
import { fileIcon } from "./fileIcon";

/** 参照種別を優先し、シンボルやファイルのアイコンを選ぶ。 */
export function referenceIcon(path: ComposerTarget) {
	if (path.kind === "changes") {
		return GitCompare;
	}
	if (path.kind === "session") {
		return MessageSquare;
	}
	if (path.symbol) {
		return Braces;
	}
	if (path.kind === "directory") {
		return Folder;
	}
	return fileIcon(path.name);
}

/** 参照の種類を読み上げ用の名前へ変換する。 */
export function referenceKindLabel(path: ComposerTarget) {
	if (path.kind === "changes") {
		return "Changes";
	}
	if (path.kind === "session") {
		return path.mode === "handoff" ? "ハンドオフ" : "セッション";
	}
	if (path.symbol) {
		return "シンボル";
	}
	if (path.kind === "directory") {
		return "フォルダ";
	}
	return "ファイル";
}

/** 参照を開く操作に対応する読み上げ文言を返す。 */
export function referenceActionLabel(path: ComposerTarget) {
	if (path.kind === "session" || path.kind === "changes") {
		return `${path.name} の内容を表示`;
	}
	if (path.kind === "directory") {
		return `${path.name} をExplorerで表示`;
	}
	return `${path.name} を開く`;
}
