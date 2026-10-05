// Sandbox の検査結果・権限・拒否を表示する。設定値や資格情報の中身は受け取らない。
import { useEffect, useState } from "react";
import type {
	SandboxBridge,
	SandboxSnapshot,
} from "@nerita/shared/sandboxManagement";
import type { CommandPermissionKey } from "@nerita/shared/commandPermission";
import { buttonStyle, inputStyle } from "../agentManager/Fields";

/** 状態は Host の応答で確定し、取消操作が失敗したときに表示だけ消さない。 */
export function SandboxSettings({ bridge }: { bridge: SandboxBridge }) {
	const [state, setState] = useState<SandboxSnapshot>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		const unsubscribe = bridge.subscribe((reply) => {
			if (reply.type === "error") {
				setError(reply.message);
				return;
			}
			setState(reply.state);
			setBusy(reply.busy);
		});
		bridge.postMessage({ type: "ready" });
		return unsubscribe;
	}, [bridge]);
	const probe = () => {
		setError("");
		setBusy(true);
		bridge.postMessage({ type: "probe" });
	};
	const revoke = (permission: CommandPermissionKey) => {
		setError("");
		setBusy(true);
		bridge.postMessage({ type: "revoke", permission });
	};
	return (
		<main className="mx-auto grid max-w-4xl gap-6 p-6 font-sans text-foreground">
			<header>
				<h1 className="m-0 text-xl font-semibold">Sandbox</h1>
				<p className="text-sm text-muted">
					Pi の実行環境と、ホスト実行の承認を管理します。
				</p>
			</header>
			{error && (
				<p role="alert" className="text-sm">
					{error}
				</p>
			)}
			{state ? (
				<>
					<SandboxBackend state={state} busy={busy} probe={probe} />
					<CommandGrants state={state} busy={busy} revoke={revoke} />
					<SandboxResources state={state} />
				</>
			) : (
				<p role="status">読み込み中…</p>
			)}
		</main>
	);
}

/** クラス・保存範囲・経路を並記し、今回だけの承認を永続設定として表示しない。 */
function CommandGrants({
	state,
	busy,
	revoke,
}: {
	state: SandboxSnapshot;
	busy: boolean;
	revoke: (permission: CommandPermissionKey) => void;
}) {
	return (
		<section className="grid gap-3" aria-label="コマンドの承認">
			<h2 className="m-0 text-lg font-semibold">コマンドの承認</h2>
			<p className="m-0 text-sm text-muted">
				照会、スクリプト実行、インストール・通信を個別に承認します。ホスト実行は
				Sandbox の制限を受けません。
			</p>
			{state.grants.length === 0 && (
				<p className="m-0 text-sm">
					保持中の承認はありません。必要な実行時に確認します。
				</p>
			)}
			{state.grants.map((grant) => (
				<article
					key={JSON.stringify(grant.permission)}
					className="grid gap-2 rounded border border-input-border p-3 text-sm"
				>
					<strong>
						{grant.permission.tool} ·{" "}
						{grant.permission.commandClass}
					</strong>
					<span>
						{grant.permission.route} ·{" "}
						{grant.scope === "workspace"
							? "このワークスペース"
							: "セッション中"}
					</span>
					<span className="break-all text-muted">
						{grant.permission.workspace}
					</span>
					<button
						type="button"
						className={buttonStyle}
						disabled={busy}
						onClick={() => revoke(grant.permission)}
					>
						承認を取り消す
					</button>
				</article>
			))}
		</section>
	);
}

/** 拒否レポートが空でもアクセス成功とは表示しない。 */
function SandboxResources({ state }: { state: SandboxSnapshot }) {
	const reports = {
		"not-run": "まだ実行していません。",
		reported: "拒否イベントを受信しました。",
		empty: "拒否レポートは空です。アクセス成功を保証する結果ではありません。",
		unavailable: "拒否レポートを取得できませんでした。",
	};
	return (
		<>
			<section className="grid gap-3" aria-label="開発ツールのリソース">
				<h2 className="m-0 text-lg font-semibold">
					開発ツールのリソース
				</h2>
				<p className="m-0 text-sm text-muted">
					最後の Sandbox
					実行に使用した権限です。資格情報は既定で拒否し、キャッシュは
					Nerita の管理領域を使用します。
				</p>
				{state.resources.length === 0 && (
					<p className="m-0 text-sm">
						実行後に検出結果を表示します。
					</p>
				)}
				{state.resources.map((resource) => (
					<details
						key={resource.id}
						className="rounded border border-input-border p-3 text-sm"
					>
						<summary>
							{resource.kind} · {resource.tool ?? "共通"} ·{" "}
							{resource.access}
						</summary>
						<p className="break-all">{resource.target}</p>
						<p className="text-muted">
							{resource.scope} · {resource.source}
						</p>
					</details>
				))}
			</section>
			<section className="grid gap-3" aria-label="拒否イベント">
				<h2 className="m-0 text-lg font-semibold">拒否イベント</h2>
				<p className="m-0 text-sm text-muted">
					{reports[state.reportStatus]}
				</p>
				{state.denials.map((event) => (
					<article
						key={event.id}
						className="rounded border border-input-border p-3 text-sm"
					>
						<p>
							{event.resource?.kind ?? "未分類"} ·{" "}
							{event.requestedAccess}
						</p>
						<p className="break-all">{event.target}</p>
						<p>利用ツール: {event.estimatedTool ?? "未特定"}</p>
						<p className="text-muted">
							拒否を維持しています。権限は自動追加されません。
						</p>
					</article>
				))}
			</section>
		</>
	);
}

/** 利用可否と起動検査をまとめ、未実装の Docker を選択できない状態で表示する。 */
function SandboxBackend({
	state,
	busy,
	probe,
}: {
	state: SandboxSnapshot;
	busy: boolean;
	probe: () => void;
}) {
	return (
		<section className="grid gap-3" aria-label="実行環境">
			<label className="grid gap-2 text-sm">
				実行環境
				<select
					className={inputStyle}
					value={state.selected}
					disabled={busy}
					onChange={() => {}}
				>
					<option value="mxc">Microsoft MXC</option>
					<option value="docker" disabled>
						Docker（準備中）
					</option>
				</select>
			</label>
			{state.availability
				.filter((backend) => backend.id === "mxc")
				.map((backend) => (
					<div key={backend.id} className="grid gap-2 text-sm">
						<p className="m-0">
							{backend.available
								? "利用可能"
								: "利用不可・未検査"}
							{backend.isolationTier &&
								` · ${backend.isolationTier}`}
						</p>
						{backend.reason && (
							<p className="m-0 break-words text-muted">
								{backend.reason}
							</p>
						)}
						<details>
							<summary>対応機能</summary>
							<ul>
								{Object.entries(backend.uiCapabilities).map(
									([name, available]) => (
										<li key={name} className="break-words">
											{name}:{" "}
											{available ? "対応" : "非対応"}
										</li>
									),
								)}
							</ul>
						</details>
					</div>
				))}
			<button
				type="button"
				className={buttonStyle}
				disabled={busy}
				onClick={probe}
			>
				{busy ? "処理中…" : "起動を確認"}
			</button>
		</section>
	);
}
