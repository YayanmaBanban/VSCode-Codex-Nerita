// 承認の要点を常時表示し、長い実行情報は開閉できる詳細へまとめる。
import clsx from "clsx";
import type {
	PermissionField,
	PermissionPresentation,
} from "../../shared/permission";

/** タイトルのみの既存要求にも対応する承認内容。 */
export function PermissionContent({
	permission,
}: {
	permission: PermissionPresentation;
}) {
	return (
		<div className="min-w-0 text-[13px] leading-[1.7]">
			<h2 className="my-[12px] whitespace-pre-wrap text-[14px] font-semibold [overflow-wrap:anywhere]">
				{permission.title}
			</h2>
			{permission.cwd !== undefined && (
				<PermissionFields
					fields={[
						{
							id: "cwd",
							label: "作業フォルダー",
							value: permission.cwd,
							display: "text",
						},
					]}
				/>
			)}
			{permission.command !== undefined && (
				<div className="my-[12px] min-w-0">
					<div className="mb-[6px] text-muted">コマンド</div>
					<PermissionCode
						label="コマンド"
						value={permission.command}
					/>
				</div>
			)}
			<PermissionFields fields={permission.fields ?? []} />
			{!!permission.details?.length && (
				<details
					className={clsx(
						"my-[12px] min-w-0 p-[10px]",
						"rounded-[6px] border border-solid border-panel-border",
					)}
				>
					<summary className="cursor-pointer text-muted">
						詳細 ({permission.details.length})
					</summary>
					<PermissionFields fields={permission.details} />
				</details>
			)}
		</div>
	);
}

/** 短い値は２列に揃え、コードは狭い画面でも読める全幅で表示する。 */
function PermissionFields({ fields }: { fields: PermissionField[] }) {
	if (!fields.length) {
		return null;
	}
	return (
		<dl
			className={clsx(
				"my-[12px] grid min-w-0",
				"grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-[12px] gap-y-[8px]",
			)}
		>
			{fields.map((field) => (
				<div
					key={field.id}
					className={
						field.display === "code"
							? "col-span-2 min-w-0"
							: "contents"
					}
				>
					<dt className="text-muted [overflow-wrap:anywhere]">
						{field.label}
					</dt>
					<dd className="m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
						{field.display === "code" ? (
							<PermissionCode
								label={field.label}
								value={field.value}
							/>
						) : (
							field.value
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}

/** 全文を保持したまま、キーボードでもスクロールできる表示枠に収める。 */
function PermissionCode({ label, value }: { label: string; value: string }) {
	return (
		<pre
			aria-label={label}
			tabIndex={0}
			className={clsx(
				"m-0 max-h-[200px] min-w-0 max-w-full overflow-auto p-[10px]",
				"rounded-[6px] border border-solid border-panel-border bg-input text-input-text",
				"font-mono text-[12px] leading-[1.6] whitespace-pre [overflow-wrap:normal]",
			)}
		>
			<code>{value}</code>
		</pre>
	);
}
