// 設定検査のエラーと、判定理由・正規化後のパスを表示する。
import type { GuardReply } from "../../../shared/guardrails/messages";

/** 検査結果は実行結果と区別し、解析できない範囲も残す。 */
export function GuardrailsFeedback({
	reply,
}: {
	reply: Extract<GuardReply, { type: "reply" }> | null;
}) {
	if (!reply) {
		return null;
	}
	const result = reply.result;
	return (
		<section
			aria-live="polite"
			className="flex flex-col gap-2 rounded border border-panel-border bg-input p-3 text-input-text"
		>
			{reply.error ? (
				<p
					role="alert"
					className="m-0 whitespace-pre-wrap break-words text-tool-error"
				>
					{reply.error}
				</p>
			) : (
				<p className="m-0 text-[13px]">{reply.notice}</p>
			)}
			{reply.warnings.map((warning) => (
				<p key={warning} className="m-0 text-warning">
					{warning}
				</p>
			))}
			{result && (
				<>
					<strong className="text-lg">判定: {result.action}</strong>
					<ul className="my-0 pl-5">
						{result.reasons.map((reason, i) => (
							<li key={i} className="break-words">
								{reason}{" "}
								<span className="text-[12px] text-muted">
									({result.rules[i]})
								</span>
							</li>
						))}
					</ul>
					{result.paths.map((path) => (
						<p
							key={path}
							className="m-0 break-all font-editor text-[12px]"
						>
							正規化後: {path}
						</p>
					))}
					{result.uncertainties.map((text) => (
						<p key={text} className="m-0 text-[13px] text-warning">
							{text}
						</p>
					))}
				</>
			)}
		</section>
	);
}
