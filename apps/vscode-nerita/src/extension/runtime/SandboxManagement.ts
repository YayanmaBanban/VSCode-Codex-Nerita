// 実行基盤から能力・拒否・リソースを受け取り、管理画面へ秘密値を含まない状態を公開する。
import type { SandboxSnapshot } from "@nerita/shared/sandboxManagement";
import {
	resourceDecisionSchema,
	type ResourcePolicy,
	type ResourceDecision,
} from "@nerita/shared/sandboxPolicy";
import { randomUUID } from "node:crypto";
import {
	toolCallFingerprint,
	type ToolCall,
} from "../security/ApprovedToolCall";
import {
	ResourceGrantStore,
	grantable,
	type ResourceGrantStorage,
} from "./ResourceGrantStore";
import {
	CommandPermissions,
	type CommandGrantStorage,
} from "./CommandPermissions";
import { dockerAvailability, type SandboxAvailability } from "./SandboxBackend";
import type { DenialReport } from "./MxcDenials";

/** 同じ Extension Host の Pi と設定パネルで共有する。SDK や VS Code API は保持しない。 */
export class SandboxManagement {
	readonly commands: CommandPermissions;
	readonly resourceGrants: ResourceGrantStore;
	private readonly waiting = new Map<
		string,
		{
			report: DenialReport;
			call: ToolCall;
			fingerprint: string;
			operationId: string;
			signal: AbortSignal;
			resolve: (retry: boolean) => void;
			deciding?: boolean;
		}
	>();
	private readonly listeners = new Set<() => void>();
	private status: SandboxAvailability = {
		id: "mxc",
		name: "Microsoft MXC",
		available: false,
		reason: "起動検査を実行してください。",
		availableMethods: [],
		uiCapabilities: {},
	};
	private resources: ResourcePolicy[] = [];
	private report: DenialReport | undefined;
	private sessionSignal: AbortSignal | undefined;
	constructor(
		storage: CommandGrantStorage,
		resourceStorage: ResourceGrantStorage = {
			read: () => undefined,
			write: () =>
				Promise.reject(new Error("リソース権限の保存先がありません。")),
		},
	) {
		this.commands = new CommandPermissions(storage, () => this.changed());
		this.resourceGrants = new ResourceGrantStore(resourceStorage, () =>
			this.changed(),
		);
	}
	/** 同じ承認の実行内だけで拒否を解決する。新しい承認 permit は発行しない。 */
	waitForDecision(
		report: DenialReport,
		call: ToolCall,
		operationId: string,
		signal: AbortSignal,
		onPending?: () => void,
	): Promise<boolean> {
		const actionable = report.events.some(
			(event) =>
				grantable(event) ||
				(event.resource?.kind === "cache" &&
					event.resourceType === "file" &&
					!!event.resource.tool),
		);
		if (!actionable) {
			return Promise.resolve(false);
		}
		signal.throwIfAborted();
		onPending?.();
		return new Promise((resolve) => {
			const id = randomUUID();
			const finish = (retry: boolean) => {
				this.waiting.delete(id);
				signal.removeEventListener("abort", abort);
				this.changed();
				resolve(retry);
			};
			const abort = () => finish(false);
			this.waiting.set(id, {
				report: structuredClone(report),
				call,
				fingerprint: toolCallFingerprint(call),
				operationId,
				signal,
				resolve: finish,
			});
			signal.addEventListener("abort", abort, { once: true });
			this.changed();
			if (signal.aborted) {
				abort();
			}
		});
	}
	/** UI の ID を、今も待機している承認済みの呼出しへ逆引きする。 */
	async decide(input: ResourceDecision) {
		const decision = resourceDecisionSchema.parse(input);
		const waiting = [...this.waiting.values()].find((item) =>
			item.report.events.some(
				(event) => event.id === decision.denialEventId,
			),
		);
		if (
			!waiting ||
			waiting.signal.aborted ||
			toolCallFingerprint(waiting.call) !== waiting.fingerprint
		) {
			throw new Error(
				"拒否イベントは期限切れです。元の操作を再実行してください。",
			);
		}
		const event = waiting.report.events.find(
			(item) => item.id === decision.denialEventId,
		)!;
		if (waiting.deciding) {
			throw new Error("この拒否イベントは処理中です。");
		}
		waiting.deciding = true;
		try {
			if (decision.action === "allow") {
				await this.resourceGrants.allow(
					event,
					decision,
					waiting.call,
					waiting.operationId,
					waiting.signal,
				);
			} else if (decision.action === "use-sandbox-cache") {
				await this.resourceGrants.switchCache(
					event,
					waiting.call,
					waiting.signal,
				);
			}
			waiting.signal.throwIfAborted();
			waiting.resolve(decision.action !== "deny");
		} finally {
			waiting.deciding = false;
		}
	}
	/** 接続終了・新しい会話で待機中の再実行も無効にする。 */
	async clearSession() {
		for (const item of this.waiting.values()) {
			item.resolve(false);
		}
		await this.resourceGrants.clearSession();
		await this.commands.clearSession();
		this.report = undefined;
		this.resources = [];
		this.changed();
	}
	/** 古い接続の停止通知で、新しい会話の権限を消さない。 */
	async startSession(signal: AbortSignal) {
		await this.clearSession();
		signal.throwIfAborted();
		this.sessionSignal = signal;
		signal.addEventListener(
			"abort",
			() => {
				if (this.sessionSignal === signal) {
					void this.clearSession();
				}
			},
			{ once: true },
		);
	}
	/** 完了した検査の実際の結果だけを公開する。 */
	availability = (status: SandboxAvailability) => {
		this.status = structuredClone(status);
		this.changed();
	};
	/** 最後の実行で使用した権限を表示し、イベント登録で自動許可しない。 */
	policy = (resources: ResourcePolicy[]) => {
		this.resources = structuredClone(resources);
		this.changed();
	};
	/** 空のレポートも拒否なしの証拠として扱わず、状態を保持する。 */
	denials = (report: DenialReport) => {
		this.report = structuredClone(report);
		this.changed();
	};
	/** 管理状態の変更後に、パネルが最新の状態を再取得するための通知。 */
	changed() {
		for (const listener of this.listeners) {
			listener();
		}
	}
	/** パネル寿命に従って購読を解除する。 */
	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 内部オブジェクトを書き換えられないようコピーを返す。 */
	snapshot(): SandboxSnapshot {
		const active = new Set<string>();
		for (const item of this.waiting.values()) {
			for (const event of item.report.events) {
				active.add(event.id);
			}
		}
		return structuredClone({
			selected: "mxc",
			availability: [this.status, dockerAvailability],
			grants: this.commands.list(),
			resourceGrants: this.resourceGrants.list(),
			cacheSwitches: this.resourceGrants.listCaches(),
			resources: this.resources,
			denials: [
				...new Map(
					[
						...(this.report?.events ?? []),
						...[...this.waiting.values()].flatMap(
							(item) => item.report.events,
						),
					].map((event) => [event.id, event]),
				).values(),
			].map((event) => {
				return {
					...event,
					actions: active.has(event.id)
						? [
								"deny" as const,
								...(grantable(event) ? ["allow" as const] : []),
								...(event.resourceType === "file" &&
								event.resource?.kind === "cache" &&
								event.resource.tool
									? ["use-sandbox-cache" as const]
									: []),
							]
						: [],
				};
			}),
			reportStatus: this.report?.status ?? "not-run",
		});
	}
}
