// 接続中の子の会話を保持し、既存 AgentViewer の読み取り契約へ変換する。
import { randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
import { initialState, type ChatState } from "../../../shared/chatState";
import {
	agentIconKey,
	type AgentThreadView,
	type AgentStatus,
	type SubAgentSummary,
} from "../../../shared/subAgents";
import { PiEventMapper } from "./PiEventMapper";
import { finishPiTools } from "./PiToolMapper";
import type { PiEvent } from "./PiRuntime";
import type { PiAgentRecord } from "./PiAgentHistory";

/** 子の終了後も現在の接続中は読み取り専用で会話を参照できる。 */
export class PiAgentViews {
	private entries = new Map<
		string,
		{ summary: SubAgentSummary; state: ChatState; mapper: PiEventMapper }
	>();
	private listeners = new Set<() => void>();
	parentId = "";
	private saveError: Error | undefined;
	private rootCwd = ".";

	/** 保存処理は親の SessionManager に結び付け、子から保存先を指定させない。 */
	constructor(private readonly save?: (record: PiAgentRecord) => void) {}

	/** フォーク先では親 ID を付け替え、過去の処理は再実行しない。 */
	restore(records: PiAgentRecord[], parentId: string, cwd: string): void {
		this.parentId = parentId;
		this.rootCwd = cwd;
		for (const record of records) {
			const childCwd = resolve(cwd, record.cwd);
			const summary = { ...record.summary, parentThreadId: parentId };
			if (["running", "pendingInit", "idle"].includes(summary.status)) {
				summary.status = "interrupted";
			}
			const state: ChatState = {
				...initialState(),
				cwd: childCwd,
				sessionId: summary.threadId,
				runId: summary.threadId,
				messages: record.messages.map((message) => ({
					...message,
					streaming: false,
				})),
				tools: record.tools.map((tool) => ({ ...tool, cwd: childCwd })),
			};
			state.tools = finishPiTools(state, true);
			this.entries.set(summary.threadId, {
				summary,
				state,
				mapper: new PiEventMapper(),
			});
		}
	}

	/** 親だけが作成した識別子を公開し、任意の保存ファイルは読み込まない。 */
	start(activityItemId: string, name: string, task: string, cwd: string) {
		if (this.entries.size >= 128) {
			throw new Error(
				"子の会話は1接続につき128件までです。新しい会話を開始してください。",
			);
		}
		const id = randomUUID();
		const state = {
			...initialState(),
			sessionId: id,
			runId: id,
			cwd,
			messages: [
				{
					id: randomUUID(),
					role: "user" as const,
					text: task,
					order: 0,
				},
			],
		};
		this.entries.set(id, {
			state,
			mapper: new PiEventMapper(),
			summary: {
				threadId: id,
				parentThreadId: this.parentId,
				activityItemId,
				agentPath: name,
				nickname: name,
				status: "pendingInit",
				iconKey: agentIconKey(id),
				order: this.entries.size,
			},
		});
		this.persist(id);
		this.changed();
		return id;
	}

	/** 子の本文と Tool を親とは別のタイムラインへ蓄積する。 */
	event(id: string, event: PiEvent) {
		const entry = this.entries.get(id)!;
		Object.assign(entry.state, entry.mapper.apply(event, entry.state));
		// 長時間の子が表示用メモリーを無制限に消費しないよう末尾を保持する。
		entry.state.messages = entry.state.messages
			.slice(-256)
			.map((message) => ({
				...message,
				text: message.text.slice(-32768),
			}));
		entry.state.tools = entry.state.tools.slice(-128).map((tool) => ({
			...tool,
			rawInput: boundedValue(tool.rawInput),
			content: (tool.content ?? []).slice(-16).map(boundedValue),
		}));
		if (
			event.type === "message_end" ||
			event.type === "tool_execution_start" ||
			event.type === "tool_execution_end"
		) {
			// SDK の通知先が例外を吸収しても、完了時に保存失敗を必ず報告する。
			try {
				this.persist(id);
			} catch (error) {
				this.saveError =
					error instanceof Error
						? error
						: new Error("子の会話を保存できませんでした。");
			}
		}
	}

	/** 承認待ち・実行・終了を親のカードへ通知する。 */
	status(id: string, status: AgentStatus) {
		const entry = this.entries.get(id)!;
		entry.summary.status = status;
		if (status !== "running" && status !== "pendingInit") {
			entry.state.tools = finishPiTools(
				entry.state,
				status === "interrupted",
			);
			entry.state.messages = entry.state.messages.map((message) => ({
				...message,
				streaming: false,
			}));
		}
		try {
			this.persist(id);
		} finally {
			this.changed();
		}
	}

	/** 一時的な表示だけで成功とせず、保存できなければ子の実行結果を失敗にする。 */
	private persist(id: string) {
		if (this.saveError) {
			throw this.saveError;
		}
		const entry = this.entries.get(id)!;
		this.save?.({
			version: 1,
			cwd: relative(this.rootCwd, entry.state.cwd ?? this.rootCwd) || ".",
			summary: entry.summary,
			messages: entry.state.messages,
			tools: entry.state.tools,
		});
	}

	/** 現在の接続に属するカードだけを返す。 */
	list(): SubAgentSummary[] {
		return [...this.entries.values()].map((entry) => ({
			...entry.summary,
		}));
	}

	/** 他の接続の ID や未知の ID による会話取得を拒否する。 */
	read(id: string): AgentThreadView {
		const entry = this.entries.get(id);
		if (!entry) {
			throw new Error("このPi接続に子の会話がありません。");
		}
		return structuredClone({
			threadId: id,
			parentThreadId: this.parentId,
			messages: entry.state.messages,
			tools: entry.state.tools,
			agents: [],
		});
	}

	/** 親の実行期間だけカードの状態変更を購読する。 */
	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 会話本文は Viewer の定期取得に任せ、カードの変化だけを通知する。 */
	private changed() {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

/** 大きな Tool 入出力は表示用だけを短縮し、SDK の実行結果は変更しない。 */
function boundedValue(value: unknown): unknown {
	const text = JSON.stringify(value);
	return text && text.length > 8192
		? `${text.slice(0, 8192)}\n（表示を省略）`
		: value;
}
