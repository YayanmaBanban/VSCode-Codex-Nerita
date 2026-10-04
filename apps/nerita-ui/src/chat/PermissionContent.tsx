// 承認の要点を常時表示し、長い実行情報は開閉できる詳細へまとめる。
import { cn } from "cnfast";
import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import type {
	PermissionField,
	PermissionPresentation,
} from "@nerita/shared/permission";

/** タイトルのみの既存要求にも対応する承認内容。 */
export function PermissionContent({
	permission,
}: {
	permission: PermissionPresentation;
}) {
	return (
		<div className="min-w-0 text-[13px] leading-[1.7]">
			<h2
				className={cn(
					"my-[12px] text-[14px] font-semibold [overflow-wrap:anywhere]",
					"whitespace-pre-wrap",
				)}
			>
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
			<PermissionFields fields={permission.fields ?? []} />
			{!!permission.details?.length && (
				<PermissionDetails fields={permission.details} />
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
		</div>
	);
}

/** 短い値は2列に揃え、コードは狭い画面でも読める全幅で表示する。 */
function PermissionFields({ fields }: { fields: PermissionField[] }) {
	if (!fields.length) {
		return null;
	}
	return (
		<dl
			className={cn(
				"my-[12px] grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-[12px]",
				"gap-y-[8px]",
			)}
		>
			{fields.map((field) => (
				<div
					key={field.id}
					className={cn(
						field.display === "code"
							? "col-span-2 min-w-0"
							: "contents",
					)}
				>
					<dt className="[overflow-wrap:anywhere] text-muted">
						{field.label}
					</dt>
					<dd className="m-0 min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
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
			className={cn(
				"m-0 max-h-[200px] max-w-full min-w-0 overflow-auto p-[10px]",
				"rounded-[6px] border border-solid border-panel-border bg-input",
				"text-input-text",
				"font-mono text-[12px] leading-[1.6] [overflow-wrap:normal] whitespace-pre",
			)}
		>
			<code>{value}</code>
		</pre>
	);
}

/** 詳細の内容を保持し、閉じた内容への操作を防ぎながら高さを変える。 */
function PermissionDetails({ fields }: { fields: PermissionField[] }) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const detailsId = useId();
	return (
		<div
			className={cn(
				"my-[12px] min-w-0 rounded-[6px] border border-solid border-panel-border",
				"p-[10px]",
			)}
		>
			<button
				type="button"
				aria-expanded={detailsOpen}
				aria-controls={detailsId}
				onClick={() => setDetailsOpen((open) => !open)}
				className="flex w-full cursor-pointer items-center gap-[4px] border-0 bg-transparent p-0 text-left text-muted"
			>
				<ChevronRight
					aria-hidden="true"
					size={14}
					className={cn(
						"shrink-0 transition-transform duration-[220ms] ease-out motion-reduce:transition-none",
						detailsOpen && "rotate-90",
					)}
				/>
				詳細 ({fields.length})
			</button>
			<div
				id={detailsId}
				inert={!detailsOpen}
				aria-hidden={!detailsOpen}
				className={cn(
					"grid transition-[grid-template-rows] duration-[220ms]",
					"ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
					detailsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">
					<PermissionFields fields={fields} />
				</div>
			</div>
		</div>
	);
}
