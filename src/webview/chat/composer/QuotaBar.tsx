// 利用枠の最小残率と、枠ごとの詳細を入力欄に表示する。
import type { QuotaWindow } from "../../../shared/composer";
import { SettingsTooltip } from "../SettingsTooltip";
import "./quotaBar.css";

/** 枠が取得できた場合だけ、控えめな波付きバーを表示する。 */
export function QuotaBar({ windows }: { windows: QuotaWindow[] | null }) {
	if (!windows?.length) {
		return null;
	}
	const remaining = Math.min(...windows.map((window) => window.remaining));
	return (
		<SettingsTooltip
			content={
				<>
					<span>利用枠の残量</span>
					<hr />
					{windows.map((window, index) => (
						<div key={`${window.label}-${index}`}>
							<div>
								{window.label}: {window.remaining}%
							</div>
							{window.detail && <div>{window.detail}</div>}
						</div>
					))}
				</>
			}
		>
			<span
				className="quota-bar inline-flex h-[24px] w-[76px] items-center rounded-[4px] hover:brightness-[1.12] focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-quota-focus focus-visible:outline-offset-2"
				role="progressbar"
				aria-label="利用枠の残量"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={remaining}
				aria-valuetext={`残り ${remaining}%`}
				tabIndex={0}
			>
				<span
					className="quota-track h-[9px] w-full overflow-hidden rounded-[5px] bg-quota-track"
					aria-hidden="true"
				>
					<span
						className="quota-fill relative block h-full overflow-hidden rounded-[inherit] bg-[#58bafa]"
						style={{ width: `${remaining}%` }}
					>
						<svg
							className="quota-wave"
							viewBox="0 0 160 12"
							preserveAspectRatio="none"
						>
							<path d="M0 6 Q20 0 40 6 T80 6 T120 6 T160 6 V12 H0Z" />
						</svg>
					</span>
				</span>
			</span>
		</SettingsTooltip>
	);
}
