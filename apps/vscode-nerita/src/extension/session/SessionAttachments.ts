// 添付ファイルの選択と寿命を、接続やモデル設定から分離する。
import type { ChatState } from "@nerita/shared/chatState";
import type { ComposerMessage } from "@nerita/shared/composer";
import type { AttachmentService } from "./attachmentService";

/** セッション状態は所有せず、操作前後に現在の会話と世代を取得する。 */
type AttachmentTarget = {
	snapshot(): ChatState;
	epoch(): number;
	busy(): boolean;
	patch(change: Partial<ChatState>): void;
};

/** 添付の寿命を接続・設定の継承順から独立させる。 */
export class SessionAttachments {
	/** 添付先の会話・接続世代と、ファイルの選択・表示に使うサービスを受け取る。 */
	constructor(
		private readonly target: AttachmentTarget,
		private readonly files?: AttachmentService,
	) {}

	/** 添付を選択・表示・削除し、選択結果は同じ会話・接続世代にだけ反映する。 */
	async attachment(
		message: Exclude<ComposerMessage, { type: "config/set" }>,
	): Promise<void> {
		if (!this.files || this.target.busy()) {
			throw new Error("現在、添付ファイルを操作できません。");
		}
		if (message.type !== "attachment/add") {
			const file = this.target
				.snapshot()
				.attachments.find((item) => item.id === message.attachmentId);
			if (!file) {
				throw new Error("指定された添付ファイルが見つかりません。");
			}
			if (message.type === "attachment/open") {
				await this.files.open(file);
			} else {
				this.target.patch({
					attachments: this.target
						.snapshot()
						.attachments.filter((item) => item.id !== file.id),
				});
			}
			return;
		}
		await this.addAttachments(message, this.files);
	}

	/** 添付の選択結果を同じ会話にだけ反映する。 */
	private async addAttachments(
		message: Extract<ComposerMessage, { type: "attachment/add" }>,
		service: AttachmentService,
	): Promise<void> {
		if (this.target.snapshot().attachmentPending) {
			return;
		}
		const epoch = this.target.epoch(),
			threadId = this.target.snapshot().sessionId;
		this.target.patch({ attachmentPending: true });
		try {
			if (message.files && !service.drop) {
				throw new Error("ファイルのドロップには対応していません。");
			}
			const selected = message.files
				? await service.drop!(message.files)
				: await service.pick();
			const matchesEpoch =
				epoch !== this.target.epoch() ||
				threadId !== this.target.snapshot().sessionId;
			if (matchesEpoch) {
				return;
			}
			const files = new Map(
				this.target
					.snapshot()
					.attachments.map((item) => [item.uri, item]),
			);
			for (const file of selected) {
				files.set(file.uri, file);
			}
			if (files.size > 20) {
				throw new Error("添付ファイルは20件までにしてください。");
			}
			this.target.patch({ attachments: [...files.values()] });
		} finally {
			if (epoch === this.target.epoch()) {
				this.target.patch({ attachmentPending: false });
			}
		}
	}

	/** 添付サービスの有無だけを返す。モデルの画像入力対応は別の判定で確認する。 */
	get supportsAttachments(): boolean {
		return !!this.files;
	}
}
