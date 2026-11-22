// 明示開始された VS Code セッションに Tailscale Serve の公開を結び付ける。
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { remoteHostname } from "./RemoteHttpServer";

const run = promisify(execFile);
const listener = z.object({ HTTPS: z.boolean().optional() });
const web = z.object({
	Handlers: z
		.record(z.string(), z.object({ Proxy: z.string().optional() }))
		.optional(),
});
const configSchema = z.object({
	TCP: z.record(z.string(), listener).optional(),
	Web: z.record(z.string(), web).optional(),
	AllowFunnel: z.record(z.string(), z.boolean()).optional(),
});
const serveSchema = configSchema.extend({
	Foreground: z.record(z.string(), configSchema).optional(),
});
const statusSchema = z.object({
	BackendState: z.string(),
	Self: z
		.object({ DNSName: z.string(), Online: z.boolean() })
		.nullable()
		.optional(),
});
/** Tailscale のノード単位と一時セッション単位で共通の公開設定。 */
type ServeConfig = z.infer<typeof configSchema>;

/** 予測できる失敗だけをそのまま設定画面に出す。 */
export class ServeFailure extends Error {}

/** CLI が使う Windows 標準のインストール場所を Host 側で固定する。 */
function executable(): string {
	const programFiles = process.env.ProgramFiles;
	if (programFiles === undefined) {
		throw new ServeFailure(
			"Tailscale を Windows にインストールしてください。",
		);
	}
	return join(programFiles, "Tailscale", "tailscale.exe");
}

/** 設定ファイルを直接読まず、現在のデーモンの状態だけを取得する。 */
async function cliJson(
	path: string,
	args: string[],
	signal?: AbortSignal,
): Promise<unknown> {
	try {
		const { stdout } = await run(path, args, {
			timeout: 4000,
			maxBuffer: 2 * 1024 * 1024,
			windowsHide: true,
			signal,
		});
		const parsed: unknown = JSON.parse(stdout);
		return parsed;
	} catch {
		signal?.throwIfAborted();
		throw new ServeFailure(
			"Windows の Tailscale を起動し、tailnet への接続を確認してください。",
		);
	}
}

/** 別のアプリの HTTPS、TCP 転送、Funnel も同じポートの競合として扱う。 */
function occupiesHttps(config: ServeConfig): boolean {
	const keys = [
		...Object.keys(config.Web ?? {}),
		...Object.keys(config.AllowFunnel ?? {}),
	];
	return (
		config.TCP?.["443"] !== undefined ||
		keys.some((key) => key.endsWith(":443"))
	);
}

/** 443 を使う既存設定を検査し、今回作成した構成の確認に使う。 */
async function serveConfig(path: string, signal?: AbortSignal) {
	const parsed = serveSchema.safeParse(
		await cliJson(path, ["serve", "status", "--json"], signal),
	);
	if (!parsed.success) {
		throw new ServeFailure(
			"Tailscale Serve の公開設定を確認できませんでした。",
		);
	}
	return parsed.data;
}

/** ローカルノードが参加中の tailnet から検証済みの FQDN を得る。 */
async function connectedHostname(
	path: string,
	signal: AbortSignal,
): Promise<string> {
	const status = statusSchema.safeParse(
		await cliJson(path, ["status", "--json"], signal),
	);
	const self =
		status.success && status.data.BackendState === "Running"
			? status.data.Self
			: undefined;
	const hostname = self?.DNSName.replace(/\.$/u, "").toLowerCase() ?? "";
	if (self?.Online !== true || !remoteHostname(hostname)) {
		throw new ServeFailure(
			"Tailscale に接続し、MagicDNS を有効にしてください。",
		);
	}
	return hostname;
}

/** Tailscale がフォアグラウンド CLI の終了に合わせて公開を解除する。 */
export class TailscaleServe {
	private child: ChildProcess | undefined;
	private closed: Promise<void> | undefined;

	/** 監視対象のホスト名は Tailscale 自身から取得した値に限定する。 */
	private constructor(
		private readonly path: string,
		readonly hostname: string,
	) {}

	/** FQDN を検出し、既存の 443 公開設定がある場合は手を加えず開始を拒否する。 */
	static async prepare(
		requested: string,
		signal: AbortSignal,
	): Promise<TailscaleServe> {
		const path = executable();
		const hostname = await connectedHostname(path, signal);
		if (requested !== "" && requested !== hostname) {
			throw new ServeFailure(
				"接続先 FQDN をこの PC の Tailscale 名と一致させてください。",
			);
		}
		const config = await serveConfig(path, signal);
		const routes = [config, ...Object.values(config.Foreground ?? {})];
		if (routes.some(occupiesHttps)) {
			throw new ServeFailure(
				"Tailscale の TCP 443 は既に使用されています。既存の Serve または Funnel の設定を確認してください。",
			);
		}
		return new TailscaleServe(path, hostname);
	}

	/** 一時公開を起動し、HTTPS の転送先が反映されるまで待つ。 */
	async start(port: number, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const target = `http://127.0.0.1:${port}`;
		const child = spawn(this.path, ["serve", "--https=443", target], {
			windowsHide: true,
			stdio: "ignore",
		});
		this.child = child;
		this.closed = new Promise((resolve) => {
			child.once("close", () => resolve());
		});
		child.on("error", () => {});
		void this.closed.then(() => {
			this.child = undefined;
		});
		await this.waitForRoute(target, signal);
	}

	/** 所定の HTTPS ルートだけを起動成功として扱い、CLI が早く終了した場合も検出する。 */
	private async waitForRoute(
		target: string,
		signal: AbortSignal,
	): Promise<void> {
		const hostname = `${this.hostname}:443`;
		const deadline = Date.now() + 10_000;
		while (this.isRunning() && Date.now() < deadline) {
			const config = await serveConfig(this.path, signal);
			const serves = Object.values(config.Foreground ?? {}).some(
				(route) => {
					const handler = route.Web?.[hostname]?.Handlers?.["/"];
					const https = route.TCP?.["443"]?.HTTPS === true;
					return (
						https &&
						handler?.Proxy === target &&
						route.AllowFunnel?.[hostname] !== true
					);
				},
			);
			if (serves && this.isRunning()) {
				return;
			}
			await delay(200, undefined, { signal });
		}
		throw new ServeFailure(
			"Tailscale Serve を開始できません。Tailscale 管理画面で HTTPS 証明書を有効にし、TCP 443 の設定を確認してください。",
		);
	}

	/** spawn 失敗や停止完了の直前も公開中と扱わない。 */
	private isRunning(): boolean {
		return (
			this.child !== undefined &&
			this.child.exitCode === null &&
			!this.child.killed
		);
	}

	/** ユーザーが Tailscale を終了した場合も、PC の表示と HTTP サーバーを止められるようにする。 */
	onExit(listener: () => void): void {
		void this.closed?.then(listener);
	}

	/** Nerita が起動したプロセスだけを終了し、他の公開設定に触れない。 */
	async stop(): Promise<void> {
		this.child?.kill();
		await this.closed;
	}
}
