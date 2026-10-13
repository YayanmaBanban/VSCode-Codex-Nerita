// ツールカードの表示選択を、開閉状態や停止操作から分離する。
import FilePenLine from "@lucide/svelte/icons/file-pen-line";
import Sprout from "@lucide/svelte/icons/sprout";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Wrench from "@lucide/svelte/icons/wrench";
import Terminal from "@lucide/svelte/icons/terminal";
import Image from "@lucide/svelte/icons/image";
import Signal from "@lucide/svelte/icons/signal";
import PlugZap from "@lucide/svelte/icons/plug-zap";
import ShelvingUnit from "@lucide/svelte/icons/shelving-unit";
import FileText from "@lucide/svelte/icons/file-text";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import type { ToolSummary } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import GuardianReview from "./GuardianReview.svelte";
import EditingFiles from "./EditingFiles.svelte";
import ExecuteTool from "./ExecuteTool.svelte";
import RawTool from "./RawTool.svelte";
import ReadTool from "./ReadTool.svelte";
import ImageViewTool from "./ImageViewTool.svelte";
import ThinkTool from "./ThinkTool.svelte";
import WebSearchTool from "./WebSearchTool.svelte";

/** Guardian の審査結果、App Server 項目の専用表示、ツール種別による表示の順に選ぶ。 */
export function toolRenderer(tool: ToolSummary) {
	// Guardian の審査結果は `think` の場合も専用の盾アイコンを維持する。
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

/** 専用の表示を持つ App Server 項目のアイコンと本文を選ぶ。 */
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
