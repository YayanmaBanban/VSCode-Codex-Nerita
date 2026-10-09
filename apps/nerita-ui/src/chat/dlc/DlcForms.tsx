// 原文と明示的なプロファイル・タスク入力を、そのまま Host の検証境界へ渡す。
import { useState, type SyntheticEvent, type ReactNode } from "react";
import {
	ExecutionProfileSchema,
	DlcProjectTypeSchema,
	type DlcProjectType,
	type ExecutionProfile,
	type DlcTask,
} from "@nerita/shared/dlc/contracts";
import type { UiMessage } from "@nerita/shared/messages";

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label>
			{label}
			{children}
		</label>
	);
}
export function IntentForm({
	send,
	onSubmitted,
	pending,
}: {
	send: (message: UiMessage) => void;
	onSubmitted: (requestId: string) => void;
	pending: boolean;
}) {
	const [title, setTitle] = useState("");
	const [request, setRequest] = useState("");
	const [profile, setProfile] = useState<ExecutionProfile>("classic");
	const [projectType, setProjectType] = useState<DlcProjectType | "detected">(
		"detected",
	);
	const submit = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (pending) {
			return;
		}
		const requestId = crypto.randomUUID();
		onSubmitted(requestId);
		send({
			type: "dlc/create",
			requestId,
			title,
			request,
			profile,
			...(projectType === "detected" ? {} : { projectType }),
		});
	};
	return (
		<form className="dlc-form" onSubmit={submit}>
			<Field label="Intent のタイトル">
				<input
					required
					maxLength={256}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
			</Field>
			<Field label="開発したい内容">
				<textarea
					required
					maxLength={16000}
					value={request}
					onChange={(event) => setRequest(event.target.value)}
				/>
			</Field>
			<details>
				<summary>詳細設定</summary>
				<ExecutionSettings
					profile={profile}
					onProfile={setProfile}
					projectType={projectType}
					onProjectType={setProjectType}
				/>
			</details>
			<button
				type="submit"
				disabled={
					pending || title.trim() === "" || request.trim() === ""
				}
			>
				{pending ? "作成中…" : "Intent を作成"}
			</button>
		</form>
	);
}
function ExecutionSettings({
	profile,
	onProfile,
	projectType,
	onProjectType,
}: {
	profile: ExecutionProfile;
	onProfile: (value: ExecutionProfile) => void;
	projectType: DlcProjectType | "detected";
	onProjectType: (value: DlcProjectType | "detected") => void;
}) {
	return (
		<>
			<Field label="実行プロファイル">
				<select
					aria-label="実行プロファイル"
					value={profile}
					onChange={(event) =>
						onProfile(
							ExecutionProfileSchema.parse(event.target.value),
						)
					}
				>
					{ExecutionProfileSchema.options.map((value) => (
						<option key={value}>{value}</option>
					))}
				</select>
			</Field>
			<Field label="開発上の扱い">
				<select
					aria-label="開発上の扱い"
					value={projectType}
					onChange={(event) =>
						onProjectType(
							event.target.value === "detected"
								? "detected"
								: DlcProjectTypeSchema.parse(
										event.target.value,
									),
						)
					}
				>
					<option value="detected">検出結果に従う</option>
					<option value="greenfield">新規開発</option>
					<option value="brownfield">既存コードを変更</option>
					<option value="unknown">判断を保留</option>
				</select>
			</Field>
		</>
	);
}
export function TaskForm({ onPlan }: { onPlan: (tasks: DlcTask[]) => void }) {
	const [tasks, setTasks] = useState<DlcTask[]>([]);
	const [title, setTitle] = useState("");
	const [instructions, setInstructions] = useState("");
	const [paths, setPaths] = useState("");
	const task = (): DlcTask => ({
		title,
		instructions,
		paths: paths
			.split(",")
			.map((value) => value.trim().replaceAll("\\", "/")),
	});
	const valid =
		title.trim() !== "" &&
		instructions.trim() !== "" &&
		paths.trim() !== "";
	const add = () => {
		setTasks([...tasks, task()]);
		setTitle("");
		setInstructions("");
		setPaths("");
	};
	return (
		<form
			className="dlc-form"
			onSubmit={(event) => {
				event.preventDefault();
				onPlan([...tasks, task()]);
			}}
		>
			<h3>手動タスクの登録</h3>
			{tasks.length > 0 && <p>{tasks.length} 件を追加済み</p>}
			<Field label="タスク名">
				<input
					required
					value={title}
					maxLength={256}
					onChange={(event) => setTitle(event.target.value)}
				/>
			</Field>
			<Field label="実装する内容">
				<textarea
					required
					value={instructions}
					maxLength={16000}
					onChange={(event) => setInstructions(event.target.value)}
				/>
			</Field>
			<Field label="対象ファイル（相対パス、カンマ区切り）">
				<input
					required
					value={paths}
					onChange={(event) => setPaths(event.target.value)}
				/>
			</Field>
			<div className="dlc-toolbar">
				<button
					type="button"
					disabled={!valid || tasks.length >= 49}
					onClick={add}
				>
					次のタスクを追加
				</button>
				<button type="submit" disabled={!valid}>
					プランを登録
				</button>
			</div>
		</form>
	);
}
