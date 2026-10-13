// 添付一覧と入力文中の参照で、ファイル種別のアイコンを揃える。
import File from "@lucide/svelte/icons/file";
import FileCode from "@lucide/svelte/icons/file-code";
import FileImage from "@lucide/svelte/icons/file-image";
import FileText from "@lucide/svelte/icons/file-text";
import FileArchive from "@lucide/svelte/icons/file-archive";
import FileSpreadsheet from "@lucide/svelte/icons/file-spreadsheet";
import FileHeadphone from "@lucide/svelte/icons/file-headphone";
import FilePlay from "@lucide/svelte/icons/file-play";

/** 拡張子によってファイルを判別し、未知の種類は汎用アイコンに戻す。 */
export function fileIcon(name: string) {
	const ext = name.split(".").at(-1)?.toLowerCase() ?? "";
	if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) {
		return FileImage;
	}
	const matchesIncludes = [
		"ts",
		"tsx",
		"js",
		"jsx",
		"json",
		"py",
		"rs",
		"go",
		"html",
		"css",
		"yml",
		"yaml",
	].includes(ext);
	if (matchesIncludes) {
		return FileCode;
	}
	if (["csv", "xlsx", "xls", "ods"].includes(ext)) {
		return FileSpreadsheet;
	}
	if (["zip", "gz", "tar", "7z"].includes(ext)) {
		return FileArchive;
	}
	if (["mp3", "wav", "ogg", "m4a"].includes(ext)) {
		return FileHeadphone;
	}
	if (["mp4", "webm", "mov"].includes(ext)) {
		return FilePlay;
	}
	if (["txt", "md", "pdf", "docx", "log"].includes(ext)) {
		return FileText;
	}
	return File;
}
