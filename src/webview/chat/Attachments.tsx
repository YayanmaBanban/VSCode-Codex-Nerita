// 添付の種別・ファイル名と、エディターで開く・取り外す操作を表示する。
import {
	File,
	FileCode,
	FileImage,
	FileText,
	FileArchive,
	FileSpreadsheet,
	FileAudio,
	FileVideo,
	X,
} from "lucide-react";
import type { Attachment } from "../../shared/composer";

/** 拡張子によってファイルを判別し、未知の種類は汎用アイコンに戻す。 */
function fileIcon(name: string) {
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

/** 添付済みファイルの ID だけを渡し、任意 URI の実行を許可しない。 */
export function Attachments({
	files,
	disabled,
	onOpen,
	onRemove,
}: {
	files: Attachment[];
	disabled: boolean;
	onOpen: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	if (!files.length) {
		return null;
	}
	return (
		<div
			className="attachments mb-[8px] flex flex-wrap gap-[6px]"
			aria-label="添付ファイル"
		>
			{files.map((file) => {
				const Icon = fileIcon(file.name);
				return (
					<span
						className="attachment inline-flex max-w-full rounded-[5px] border border-solid border-panel-border [&_svg]:shrink-0"
						key={file.id}
					>
						<button
							type="button"
							disabled={disabled}
							title={file.uri}
							aria-label={`${file.name} を開く`}
							className="inline-flex min-w-0 flex-1 items-center gap-[5px] border-0 bg-transparent px-[5px] py-[4px] text-[12px]"
							onClick={() => onOpen(file.id)}
						>
							<Icon size={14} aria-hidden="true" />
							<span className="truncate">{file.name}</span>
						</button>
						<button
							type="button"
							disabled={disabled}
							aria-label={`${file.name} を取り外す`}
							className="inline-flex min-w-0 items-center gap-[5px] border-0 bg-transparent px-[5px] py-[4px] text-[12px]"
							onClick={() => onRemove(file.id)}
						>
							<X size={12} aria-hidden="true" />
						</button>
					</span>
				);
			})}
		</div>
	);
}
