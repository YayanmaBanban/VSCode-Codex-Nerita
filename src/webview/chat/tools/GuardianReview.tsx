// Guardian の構造化された審査結果を表示し、未知の形式は汎用表示へ戻す。
import type { ToolSummary } from "../../../shared/messages";
import { isRecord } from "../../../shared/validation";
import { GenericTool, Value } from "./ToolContent";

/** 完了時の審査結果を優先し、実行中は入力側の審査情報を表示する。 */
export function GuardianReview({ tool }: { tool: ToolSummary }) {
	const input = isRecord(tool.rawInput) ? tool.rawInput : {};
	const output = isRecord(tool.rawOutput) ? tool.rawOutput : {};
	const review = isRecord(output.review) ? output.review : input.review;
	const action = isRecord(output.action) ? output.action : input.action;
	if (!isRecord(review)) {
		return <GenericTool tool={tool} />;
	}
	const fields = [
		["判断", review.status],
		["リスク", review.riskLevel],
		["ユーザーの承認", review.userAuthorization],
		["理由", review.rationale],
	];
	return (
		<>
			<dl className="guardian-fields">
				{fields
					.filter(([, value]) => value !== null && value !== undefined)
					.map(([label, value]) => (
						<div key={String(label)}>
							<dt>{String(label)}</dt>
							<dd>
								<Value value={value} />
							</dd>
						</div>
					))}
			</dl>
			{action !== undefined && (
				<section>
					<h3>対象操作</h3>
					<Value value={action} />
				</section>
			)}
		</>
	);
}
