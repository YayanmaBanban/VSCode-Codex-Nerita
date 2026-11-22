// PC の設定カードとコマンドで、ループバック待受と一時 Serve 公開を管理する。
import * as vscode from "vscode";
import {
	pairingLifetimeMs,
	type RemoteWorkspaceAction,
	type RemoteWorkspaceState,
} from "@nerita/shared/remote/workspaceControls";
import type { BackendSelection } from "../backends/BackendSelection";
import type { BackendRuntime } from "../session/BackendRuntime";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import { RemoteChatAdapter } from "./RemoteChatAdapter";
import { RemoteError } from "./RemoteError";
import {
	defaultRemotePort,
	RemoteHttpServer,
	remoteHostname,
} from "./RemoteHttpServer";
import { ServeFailure, TailscaleServe } from "./TailscaleServe";

const hostnameKey = "nerita.remote.hostname";

/** 設定カードの状態と、明示開始したアクセスの寿命を同期する。 */
export class RemoteAccessController {
	private readonly listeners = new Set<
		(state: RemoteWorkspaceState) => void
	>();
	private readonly chat: RemoteChatAdapter;
	private readonly unsubscribeTrust: () => void;
	private server: RemoteHttpServer | undefined;
	private serve: TailscaleServe | undefined;
	private startTask: Promise<void> | undefined;
	private stopTask: Promise<void> | undefined;
	private aborter: AbortController | undefined;
	private phase: RemoteWorkspaceState["phase"] = "off";
	private code: string | null = null;
	private pairingExpiresAt: number | null = null;
	private hostname = "";
	private codeExpiry: ReturnType<typeof setTimeout> | undefined;
	private error: string | null = null;
	private disposed = false;
	private trustGeneration = 0;

	/** チャットと信頼状態を既存の Host から受け取り、すべての入口で処理を共有する。 */
	constructor(
		private readonly context: vscode.ExtensionContext,
		runtime: BackendRuntime,
		selection: BackendSelection,
		trust: WorkspaceTrustStore,
	) {
		this.unsubscribeTrust = trust.onChange(() => {
			this.trustGeneration++;
		});
		this.chat = new RemoteChatAdapter(
			runtime.scope("chat"),
			selection,
			() => vscode.workspace.isTrusted,
			(root, backend) => trust.trusted(root, backend),
			() => this.trustGeneration,
		);
		context.subscriptions.push(
			this,
			vscode.commands.registerCommand("nerita.remote.start", () =>
				this.start(this.hostname),
			),
			vscode.commands.registerCommand("nerita.remote.stop", () =>
				this.stop(),
			),
			vscode.commands.registerCommand("nerita.remote.pair", () =>
				this.issueCode(),
			),
			vscode.commands.registerCommand("nerita.remote.revoke", () =>
				this.revoke(),
			),
		);
	}

	/** 起動済みの接続と作業領域の保存値を、PC の表示にだけ公開する。 */
	snapshot(): RemoteWorkspaceState {
		return {
			phase: this.phase,
			connected: this.server?.connected() === true,
			hostname: this.serve?.hostname ?? this.hostname,
			pairingCode: this.code,
			pairingExpiresAt: this.pairingExpiresAt,
			error: this.error,
		};
	}

	/** Webview の更新通知を設定操作の寿命に結び付ける。 */
	subscribe(listener: (state: RemoteWorkspaceState) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** PC の検証済み設定操作だけを実行する。 */
	async receive(action: RemoteWorkspaceAction): Promise<void> {
		switch (action.type) {
			case "ui/remoteStart":
				await this.start(action.hostname);
				break;
			case "ui/remoteStop":
				await this.stop();
				break;
			case "ui/remotePair":
				this.issueCode();
				break;
			case "ui/remoteDismissPairing":
				if (this.code === action.code) {
					this.clearCode();
				}
				break;
			case "ui/remoteRevoke":
				this.revoke();
				break;
		}
	}

	/** 明示操作を受けたときだけ、対象 PC の FQDN で公開を開始する。 */
	private async start(hostname: string): Promise<void> {
		if (this.disposed || this.phase !== "off") {
			return;
		}
		const supported =
			process.platform === "win32" && vscode.env.remoteName === undefined;
		if (!supported) {
			this.error =
				"Windows のローカル VS Code でリモートアクセスを開始してください。";
			this.publish();
			return;
		}
		const aborter = new AbortController();
		this.aborter = aborter;
		this.phase = "starting";
		this.error = null;
		this.startTask = this.activate(
			hostname.trim().toLowerCase().replace(/\.$/u, ""),
			aborter.signal,
		);
		this.publish();
		await this.startTask;
	}

	/** 公開先を確定してから固定ループバックを開き、途中で失敗した資源を回収する。 */
	private async activate(
		requested: string,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const serve = await TailscaleServe.prepare(requested, signal);
			signal.throwIfAborted();
			this.serve = serve;
			const config = vscode.workspace.getConfiguration("nerita.remote");
			const port = config.get<number>("port", defaultRemotePort);
			const server = await this.listen(serve.hostname, port);
			await serve.start(port, signal);
			await this.saveHostname(serve.hostname);
			signal.throwIfAborted();
			this.phase = "on";
			this.issueCode();
			serve.onExit(() => this.serveEnded(server));
		} catch (error) {
			await this.release();
			if (!signal.aborted) {
				this.error = startupError(error);
				this.phase = "off";
			}
		} finally {
			this.startTask = undefined;
			this.publish();
		}
	}

	/** Serve を作成する前に、静的資産とループバックの待受を準備する。 */
	private async listen(
		hostname: string,
		port: number,
	): Promise<RemoteHttpServer> {
		const server = new RemoteHttpServer(hostname, this.chat, {
			onPaired: () => this.clearCode(),
			onConnectionChange: () => this.publish(),
		});
		this.server = server;
		const directory = vscode.Uri.joinPath(
			this.context.extensionUri,
			"dist",
			"remote",
		).fsPath;
		await server.start(directory, port);
		return server;
	}

	/** PC 固有の値を復元し、旧設定の値は保存成功後に作業領域から取り除く。 */
	async loadHostname(): Promise<void> {
		try {
			this.hostname = (await this.context.secrets.get(hostnameKey)) ?? "";
			const config = vscode.workspace.getConfiguration("nerita.remote");
			const legacy = config.inspect<unknown>("fqdn")?.workspaceValue;
			if (legacy === undefined) {
				return;
			}
			if (this.hostname === "" && typeof legacy === "string") {
				await this.importHostname(legacy);
			}
			await config.update(
				"fqdn",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		} catch {
			this.error =
				"接続先を安全な保存先に移行できませんでした。VS Code の設定と SecretStorage を確認してください。";
		}
	}

	/** 旧設定に保存されていた有効な接続先だけを取り込む。 */
	private async importHostname(legacy: string): Promise<void> {
		const hostname = legacy.trim().toLowerCase().replace(/\.$/u, "");
		if (remoteHostname(hostname)) {
			await this.saveHostname(hostname);
		}
	}

	/** 接続先を VS Code の暗号化ストレージにだけ保存する。 */
	private async saveHostname(hostname: string): Promise<void> {
		await this.context.secrets.store(hostnameKey, hostname);
		this.hostname = hostname;
	}

	/** 新しいコードを PC のダイアログに表示し、失効時に表示も閉じる。 */
	private issueCode(): void {
		if (!this.server || this.phase !== "on") {
			return;
		}
		try {
			const expiresAt = Date.now() + pairingLifetimeMs;
			this.code = this.server.issueCode();
			this.pairingExpiresAt = expiresAt;
			this.error = null;
			clearTimeout(this.codeExpiry);
			this.codeExpiry = setTimeout(
				() => this.clearCode(),
				pairingLifetimeMs,
			);
		} catch (error) {
			this.error =
				error instanceof RemoteError
					? error.message
					: "ペアリングコードを発行できませんでした。";
		}
		this.publish();
	}

	/** モーダルを閉じ、未使用のコードだけを取り消す。 */
	private clearCode(): void {
		this.server?.cancelPairing();
		this.code = null;
		this.pairingExpiresAt = null;
		clearTimeout(this.codeExpiry);
		this.publish();
	}

	/** 接続端末のトークンと保留中のコードを失効させる。 */
	private revoke(): void {
		this.server?.revoke();
		this.clearCode();
	}

	/** Tailscale 側の終了も検出し、公開できない HTTP サーバーを閉じる。 */
	private serveEnded(server: RemoteHttpServer): void {
		if (this.server === server && this.phase === "on") {
			this.error = "Tailscale Serve との接続が終了しました。";
			void this.stop();
		}
	}

	/** 起動中の処理を取り消し、Nerita が開始した公開だけを停止する。 */
	stop(): Promise<void> {
		if (this.phase === "off") {
			return Promise.resolve();
		}
		this.stopTask ??= this.shutdown().finally(() => {
			this.stopTask = undefined;
		});
		return this.stopTask;
	}

	/** ブラウザー接続を先に失効させ、起動途中に確保された資源の回収も待つ。 */
	private async shutdown(): Promise<void> {
		this.phase = "stopping";
		this.aborter?.abort();
		this.server?.stop();
		this.clearCode();
		await this.startTask;
		await this.release();
		this.phase = "off";
		this.publish();
	}

	/** リソースを先に取り外し、CLI 終了通知からの二重停止を防ぐ。 */
	private async release(): Promise<void> {
		const serve = this.serve;
		this.serve = undefined;
		this.server?.stop();
		this.server = undefined;
		await serve?.stop();
	}

	/** 接続・設定・一時コードの更新を PC Webview に伝える。 */
	private publish(): void {
		const state = this.snapshot();
		for (const listener of this.listeners) {
			listener(state);
		}
	}

	/** VS Code の通常終了でも公開とチャットの購読を回収する。 */
	dispose(): void {
		this.disposed = true;
		void this.stop();
		this.unsubscribeTrust();
		this.listeners.clear();
	}
}

/** UI へ出すのは明示した失敗理由だけに限定する。 */
function startupError(error: unknown): string {
	if (error instanceof ServeFailure) {
		return error.message;
	}
	const code =
		error instanceof Error && "code" in error ? error.code : undefined;
	switch (code) {
		case "EADDRINUSE":
			return "Nerita の待受ポートは既に使用されています。";
		case "ENOENT":
			return "モバイル UI の配布ファイルが見つかりません。";
		default:
			return "リモートアクセスを開始できませんでした。ポートとワークスペース設定を確認してください。";
	}
}
