// 添付一覧と入力文中の参照で、ファイル種別のアイコンを揃える。
import {
	File,
	FileCode,
	FileImage,
	FileText,
	FileArchive,
	FileSpreadsheet,
	FileAudio,
	FileVideo,
} from "lucide-react";

/** 拡張子によってファイルを判別し、未知の種類は汎用アイコンに戻す。 */
export function fileIcon(name: string) {
	const ext = name.split(".").at(-1)?.toLowerCase() ?? "";
	if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) {
		return FileImage;
	}
	if (
		[
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
		].includes(ext)
	) {
		return FileCode;
	}
	if (["csv", "xlsx", "xls", "ods"].includes(ext)) {
		return FileSpreadsheet;
	}
	if (["zip", "gz", "tar", "7z"].includes(ext)) {
		return FileArchive;
	}
	if (["mp3", "wav", "ogg", "m4a"].includes(ext)) {
		return FileAudio;
	}
	if (["mp4", "webm", "mov"].includes(ext)) {
		return FileVideo;
	}
	if (["txt", "md", "pdf", "docx", "log"].includes(ext)) {
		return FileText;
	}
	return File;
}
