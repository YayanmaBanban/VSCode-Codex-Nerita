// 表示中の一範囲だけを保持し、出力参照から必要な UTF-8 範囲を取得する。
import { cn } from "cnfast";
import type { Bridge } from "@nerita/shared/bridge";
import {
	toolOutputChunkBytes,
	type ToolOutputPreview,
	type ToolOutputResponse,
} from "@nerita/shared/toolOutput";
import {
	createContext,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { SettingsTooltip } from "../SettingsTooltip";
import { CommandOutput } from "./CommandOutput";

export const ToolOutputBridge = createContext<Bridge | undefined>(undefined);

const rangeButtonClass =
	"inline-flex size-[28px] shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-muted enabled:hover:bg-settings-hover enabled:hover:text-foreground focus-visible:outline-1 focus-visible:outline-settings-focus disabled:opacity-40";

/** 閉じると本文を解放し、再度開いた場合は先頭の範囲を取得する。 */
export function ToolOutputView({ output }: { output: ToolOutputPreview }) {
	const bridge = useContext(ToolOutputBridge);
	const [expanded, setExpanded] = useState(false);
	const rangeId = useId();
	return (
		<section>
			<CommandOutput text={output.preview} />
			{output.truncated &&
				(output.outputRef && bridge ? (
					<>
						<button
							type="button"
							className={cn(
								"mt-[8px] inline-flex items-center gap-[6px] rounded-[5px] border-0",
								"bg-transparent px-[6px] py-[4px] text-[12px] text-muted",
								"hover:bg-settings-hover",
								"focus-visible:outline-1 focus-visible:outline-settings-focus",
							)}
							onClick={() => setExpanded(!expanded)}
							aria-expanded={expanded}
							aria-controls={rangeId}
						>
							詳細出力
							{expanded ? (
								<ChevronUp size={14} aria-hidden="true" />
							) : (
								<ChevronRight size={14} aria-hidden="true" />
							)}
						</button>
						{expanded && (
							<OutputRange
								id={rangeId}
								key={output.outputRef}
								outputRef={output.outputRef}
								bridge={bridge}
							/>
						)}
					</>
				) : (
					<p className="text-[12px] text-muted">
						省略部分の出力を取得できません。
					</p>
				))}
		</section>
	);
}

/** 前後移動の位置だけを覚え、取得済みテキストを積み重ねない。 */
function OutputRange({
	id,
	outputRef,
	bridge,
}: {
	id: string;
	outputRef: string;
	bridge: Bridge;
}) {
	const [offset, setOffset] = useState(0);
	const [previous, setPrevious] = useState<number[]>([]);
	const { range, loading, error, prepare } = useOutputChunk(
		bridge,
		outputRef,
		offset,
	);
	return (
		<section id={id} aria-label="詳細出力" aria-busy={loading}>
			<RangeContent error={error} loading={loading} range={range} />
			<div className="flex items-center gap-[8px] text-[12px] text-muted">
				<SettingsTooltip content="前の範囲を表示">
					<button
						type="button"
						className={rangeButtonClass}
						aria-label="前の範囲を表示"
						disabled={loading || !previous.length}
						onClick={() => {
							prepare();
							setOffset(previous.at(-1)!);
							setPrevious(previous.slice(0, -1));
						}}
					>
						<ChevronLeft size={16} aria-hidden="true" />
					</button>
				</SettingsTooltip>
				<SettingsTooltip content="次の範囲を表示">
					<button
						type="button"
						className={rangeButtonClass}
						aria-label="次の範囲を表示"
						disabled={loading || !!error || !range || range.eof}
						onClick={() => {
							if (!range) {
								return;
							}
							prepare();
							setPrevious([...previous, offset]);
							setOffset(range.nextOffset);
						}}
					>
						<ChevronRight size={16} aria-hidden="true" />
					</button>
				</SettingsTooltip>
				{range && !loading && !error && (
					<span>
						{range.offset.toLocaleString()}–
						{range.nextOffset.toLocaleString()} バイト
					</span>
				)}
			</div>
		</section>
	);
}

/** 要求 ID を照合し、範囲移動やカードを閉じた後の遅い応答を捨てる。 */
function useOutputChunk(bridge: Bridge, outputRef: string, offset: number) {
	const [range, setRange] = useState<ToolOutputResponse>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const pending = useRef<string | undefined>(undefined);
	useEffect(() => {
		const requestId = crypto.randomUUID();
		pending.current = requestId;
		const unsubscribe = bridge.subscribe((message) => {
			if (
				!("requestId" in message) ||
				message.requestId !== pending.current
			) {
				return;
			}
			if (
				message.type === "tool/outputResult" &&
				message.outputRef === outputRef
			) {
				setRange(message);
				setError(message.error);
				setLoading(false);
			} else if (message.type === "request/failed") {
				setError(message.error);
				setLoading(false);
			}
		});
		bridge.postMessage({
			type: "tool/output",
			requestId,
			outputRef,
			offset,
			limit: toolOutputChunkBytes,
		});
		return () => {
			pending.current = undefined;
			unsubscribe();
		};
	}, [bridge, outputRef, offset]);
	return {
		range,
		loading,
		error,
		prepare: () => {
			pending.current = undefined;
			setLoading(true);
			setError(undefined);
			setRange(undefined);
		},
	};
}

/** 取得失敗を通知し、待機中は読み込み表示を出す。 */
function RangeContent({
	error,
	loading,
	range,
}: {
	error: string | undefined;
	loading: boolean;
	range: ToolOutputResponse | undefined;
}) {
	if (error) {
		return <p role="alert">{error}</p>;
	}
	return (
		<CommandOutput
			text={loading ? "読み込み中…" : (range?.text ?? "")}
			copyDisabled={loading || !range}
		/>
	);
}
