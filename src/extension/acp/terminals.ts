// ACP端末を接続・セッション単位で管理し、出力保持と終了待ちを提供する。
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
	CreateTerminalRequest,
	TerminalOutputRequest,
	TerminalExitStatus,
} from "@agentclientprotocol/sdk";
import type { TerminalSnapshot } from "../../shared/toolTerminal";
import { killTree } from "./terminalProcess";

/** 端末の実体と出力・終了を待つ状態。 */
type Entry = {
	sessionId: string;
	child: ReturnType<typeof spawn>;
	snapshot: TerminalSnapshot;
	limit: number;
	done: Promise<TerminalExitStatus>;
	stop?: Promise<void>;
	releasing: boolean;
};
/** 全端末メソッドの共通実装。UI操作も同じ管理対象だけを利用する。 */
export class Terminals {
	private entries = new Map<string, Entry>();
	private sessions = new Set<string>();
	private closed = false;
	constructor(
		private cwd: string,
		private changed: (
			sessionId: string,
			terminalId: string,
			snapshot: TerminalSnapshot,
		) => void,
	) {}
	/** 作成済みのセッションだけに実行を許可する。 */
	allowSession(id: string): void {
		this.sessions.add(id);
	}
	/** シェル文字列に連結せず、commandとargsをそのまま起動する。 */
	async create(params: CreateTerminalRequest) {
		if (this.closed || !this.sessions.has(params.sessionId)) {
			throw new Error("Unknown session");
		}
		const cwd = params.cwd ?? this.cwd;
		const limit = params.outputByteLimit ?? 1024 * 1024;
		if (!isAbsolute(cwd) || !Number.isSafeInteger(limit) || limit < 0) {
			throw new Error("Invalid terminal parameters");
		}
		const env = { ...process.env };
		for (const variable of params.env ?? []) {
			env[variable.name] = variable.value;
		}
		// Windowsの.cmd/.batは明示的にcmd.exe経由で要求する。暗黙のshell:trueは使用しない。
		const child = spawn(params.command, params.args ?? [], {
			cwd,
			env,
			windowsHide: true,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const terminalId = randomUUID();
		let finish!: (status: TerminalExitStatus) => void;
		const entry: Entry = {
			sessionId: params.sessionId,
			child,
			limit: Math.min(limit, 8 * 1024 * 1024),
			releasing: false,
			snapshot: { cwd, output: "", truncated: false, canStop: true },
			done: new Promise((resolve) => {
				finish = resolve;
			}),
		};
		this.entries.set(terminalId, entry);
		const notify = () =>
			this.changed(entry.sessionId, terminalId, { ...entry.snapshot });
		for (const stream of [child.stdout, child.stderr]) {
			stream?.setEncoding("utf8");
			stream?.on("data", (text: string) => {
				const bytes = Buffer.from(entry.snapshot.output + text);
				let start = Math.max(0, bytes.length - entry.limit);
				// UTF-8の継続バイトを飛ばし、切り詰めで文字を壊さない。
				while (
					start < bytes.length &&
					(bytes[start]! & 0xc0) === 0x80
				) {
					start++;
				}
				entry.snapshot.output = bytes.subarray(start).toString("utf8");
				entry.snapshot.truncated ||= start > 0;
				notify();
			});
		}
		child.once("close", (exitCode, signal) => {
			entry.snapshot.exitStatus = { exitCode, signal };
			entry.snapshot.canStop = false;
			finish(entry.snapshot.exitStatus);
			notify();
		});
		try {
			await new Promise<void>((resolve, reject) => {
				child.once("spawn", resolve);
				child.once("error", reject);
			});
		} catch (error) {
			this.entries.delete(terminalId);
			throw error;
		}
		notify();
		return { terminalId };
	}
	/** 別セッション・解放後のIDは操作できない。 */
	private get(params: TerminalOutputRequest): Entry {
		const entry = this.entries.get(params.terminalId);
		if (
			!entry ||
			entry.sessionId !== params.sessionId ||
			entry.releasing ||
			this.closed
		) {
			throw new Error("Unknown terminal");
		}
		return entry;
	}
	/** UIに渡す端末の現在値を複製する。 */
	snapshot(params: TerminalOutputRequest): TerminalSnapshot | undefined {
		try {
			return { ...this.get(params).snapshot };
		} catch {
			return undefined;
		}
	}
	/** 出力は停止後もreleaseまで取得できる。 */
	output(params: TerminalOutputRequest) {
		const { output, truncated, exitStatus } = this.get(params).snapshot;
		return { output, truncated, ...(exitStatus ? { exitStatus } : {}) };
	}
	/** 終了通知は標準出力・標準エラーの排出が完了してから返す。 */
	waitForExit(params: TerminalOutputRequest) {
		return this.get(params).done;
	}
	/** 重複停止をまとめ、OS上の終了を待つ。 */
	private stop(entry: Entry): Promise<void> {
		entry.stop ??= killTree(entry.child)
			.then(() => entry.done)
			.then(() => undefined)
			.catch((error) => {
				delete entry.stop;
				throw error;
			});
		return entry.stop;
	}
	/** プロセスだけを停止し、出力と端末IDを保持する。 */
	async kill(params: TerminalOutputRequest) {
		await this.stop(this.get(params));
		return {};
	}
	/** 動作中なら停止してからIDを無効化し、UIには最後の出力を残す。 */
	async release(params: TerminalOutputRequest) {
		const entry = this.get(params);
		entry.releasing = true;
		try {
			await this.stop(entry);
			this.entries.delete(params.terminalId);
		} catch (error) {
			entry.releasing = false;
			throw error;
		}
		return {};
	}
	/** 接続の終了後は新規作成を拒否し、全端末の終了を待つ。 */
	async dispose() {
		this.closed = true;
		await Promise.all(
			[...this.entries.values()].map((entry) => this.stop(entry)),
		);
		this.entries.clear();
	}
}
