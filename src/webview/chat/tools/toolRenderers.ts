// ツールカードの表示選択を、開閉状態や停止操作から分離する。
import {
	FilePenLine,
	Sprout,
	ShieldCheck,
	Wrench,
	Terminal,
	Image,
	Signal,
	PlugZap,
	ShelvingUnit,
	FileText,
	FolderOpen,
} from "lucide-react";
import type { ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";
import { GuardianReview } from "./GuardianReview";
import { EditingFiles, ExecuteTool, RawTool } from "./ToolContent";
import { ReadTool } from "./ReadTool";
import { ImageViewTool, ThinkTool, WebSearchTool } from "./ActivityToolContent";

/** Guardian Review、専用項目、一般のツール種別の順に表示を選ぶ。 */
export function toolRenderer(tool: ToolSummary) {
	// Guardian Reviewはthinkの場合も専用の盾アイコンを維持する。
	if (tool.title.trim().toLowerCase() === "guardian review") {
		return { Icon: ShieldCheck, Body: GuardianReview };
	}
	const type =
		isRecord(tool.rawItem) && typeof tool.rawItem.type === "string"
			? tool.rawItem.type
			: tool.kind;
	return specialRenderer(type) ?? kindRenderer(tool);
}

// 専用表示を追加するときは、ここへタイトルとアイコン・本文を登録する。
const renderers = [
	{
		titles: ["editing files", "editing file", "editng file"],
		Icon: FilePenLine,
		Body: EditingFiles,
	},
];

/** 専用の表示を持つApp Server項目のアイコンと本文を選ぶ。 */
function specialRenderer(type: string | undefined) {
	if (type === "imageView") {
		return { Icon: Image, Body: ImageViewTool };
	}
	if (type === "webSearch") {
		return { Icon: Signal, Body: WebSearchTool };
	}
	if (type === "mcpToolCall") {
		return { Icon: PlugZap, Body: null };
	}
	if (type === "contextCompaction") {
		return { Icon: ShelvingUnit, Body: null };
	}
	return null;
}

/** ツール種別と既知のタイトルからアイコンと本文を選ぶ。 */
function kindRenderer(tool: ToolSummary) {
	if (tool.kind === "read" || tool.kind === "list") {
		return {
			Icon: tool.kind === "read" ? FileText : FolderOpen,
			Body: ReadTool,
		};
	}
	if (tool.kind === "think") {
		return { Icon: Sprout, Body: ThinkTool };
	}
	if (tool.kind === "execute") {
		return { Icon: Terminal, Body: ExecuteTool };
	}
	if (tool.kind === "edit") {
		return { Icon: FilePenLine, Body: EditingFiles };
	}
	return (
		renderers.find(({ titles }) =>
			titles.includes(tool.title.trim().toLowerCase()),
		) ?? { Icon: Wrench, Body: RawTool }
	);
}
