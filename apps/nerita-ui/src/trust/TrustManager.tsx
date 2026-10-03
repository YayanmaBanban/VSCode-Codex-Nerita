// 保存済みワークスペースを検索し、信頼状態を変更したり記録を削除したりする。

import { cn } from "cnfast";
import { type JSX, useEffect, useState } from "react";

import type {
	TrustBridge,
	TrustReply,
	TrustRequest,
} from "@nerita/shared/workspaceTrust";

import "../chat/chat.css";

const buttonStyle =
	"rounded border border-input-border px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-2";
const origins = {
	workspace: "ワークスペース",
	external: "外部フォルダー",
	"external-cache": "外部キャッシュ",
};

/** 信頼記録の一覧・更新要求を送受信するブリッジ。 */
type TrustManagerProps = { bridge: TrustBridge };

/** 保存先を意識せず、一覧から対象を確認して操作できる画面。 */
export function TrustManager({ bridge }: TrustManagerProps) {
	const [state, setState] = useState<TrustReply>();
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const unsubscribe = bridge.subscribe((reply) => {
			setState(reply);
			setBusy(false);
		});
		bridge.postMessage({ type: "refresh" });
		return unsubscribe;
	}, [bridge]);
	const send = (message: TrustRequest) => {
		setBusy(true);
		bridge.postMessage(message);
	};
	const records =
		state?.records.filter((record) =>
			record.root.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
		) ?? [];
	return (
		<main
			className={cn(
				"mx-auto grid w-full max-w-5xl gap-5 p-4 text-foreground",
				"sm:p-6",
			)}
		>
			<TrustManagerHeader busy={busy} send={send} />
			<label className="grid gap-2 text-sm">
				フォルダーを検索
				<input
					className={cn(
						"w-full rounded border border-input-border bg-input p-2 text-foreground",
					)}
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="名前またはパスで検索"
				/>
			</label>
			{state?.error && (
				<p role="alert" className="m-0 text-sm break-words">
					{state.error}
				</p>
			)}
			<p role="status" className="m-0 text-sm text-muted">
				{state
					? `${records.length} 件 / 全 ${state.records.length} 件`
					: "読み込み中…"}
			</p>
			<div className="grid gap-3" aria-busy={busy}>
				{records.map((record) => (
					<TrustRecord
						key={record.root}
						record={record}
						busy={busy}
						send={send}
					/>
				))}
				{state && !records.length && (
					<p className="text-sm text-muted">
						{query
							? "一致するフォルダーがありません。"
							: "保存された記録はありません。"}
					</p>
				)}
			</div>
		</main>
	);
}

/** 表示する信頼記録、処理中の状態と更新・削除要求を送信する関数。 */
type TrustRecordProps = {
	record: {
		root: string;
		trust: "trusted" | "untrusted";
		origin: "workspace" | "external" | "external-cache";
		updatedAt: number;
	};
	busy: boolean;
	send: (message: TrustRequest) => void;
};

/** 信頼記録の追加・再読み込み要求を送る関数と処理中の状態。 */
type TrustManagerHeaderProps = {
	busy: boolean;
	send: (message: TrustRequest) => void;
};

/** 記録の追加と再読込を信頼状態の変更から分けて表示する。 */
function TrustManagerHeader({ busy, send }: TrustManagerHeaderProps) {
	return (
		<header className="grid gap-3">
			<h1 className="m-0 text-xl font-semibold">ワークスペースの信頼</h1>
			<p className="m-0 text-sm text-muted">
				Pi
				が利用するフォルダーの信頼状態を管理します。記録を削除しても、フォルダーやファイルは残ります。
			</p>
			<div className="flex flex-wrap gap-2">
				<button
					className={buttonStyle}
					disabled={busy}
					onClick={() => send({ type: "add" })}
				>
					フォルダーを追加
				</button>
				<button
					className={buttonStyle}
					disabled={busy}
					onClick={() => send({ type: "refresh" })}
				>
					再読み込み
				</button>
			</div>
		</header>
	);
}

/** 保存された信頼状態と記録の削除・変更操作を表示する。 */
function TrustRecord({ record, busy, send }: TrustRecordProps): JSX.Element {
	return (
		<article
			key={record.root}
			className="grid gap-3 rounded-md border border-input-border p-4"
		>
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<strong>
					{record.trust === "trusted" ? "信頼済み" : "未信頼"}
				</strong>
				<span className="text-muted">{origins[record.origin]}</span>
			</div>
			<h2 className="m-0 font-mono text-sm font-normal break-all">
				{record.root}
			</h2>
			<p className="m-0 text-xs text-muted">
				更新: {new Date(record.updatedAt).toLocaleString("ja-JP")}
			</p>
			<div className="flex flex-wrap gap-2">
				<button
					className={buttonStyle}
					disabled={busy || record.origin === "external-cache"}
					onClick={() =>
						send({
							type:
								record.trust === "trusted" ? "revoke" : "trust",
							root: record.root,
						})
					}
				>
					{record.trust === "trusted" ? "信頼を取り消す" : "信頼する"}
				</button>
				<button
					className={buttonStyle}
					disabled={busy}
					onClick={() => send({ type: "remove", root: record.root })}
				>
					記録を削除
				</button>
			</div>
		</article>
	);
}
