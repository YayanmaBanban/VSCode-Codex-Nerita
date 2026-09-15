// 設定変更と添付ファイル操作を会話の実行制御から分離する。
import type { Attachment, ComposerMessage } from "../../shared/composer";
import { SessionLifecycle, type TransportFactory } from "./sessionLifecycle";
import { configOptions } from "./configuration";

/** VS Code の操作をテスト用サービスへ差し替える境界。 */
export type AttachmentService = {
	pick: () => Promise<Attachment[]>;
	open: (file: Attachment) => Promise<void>;
};

/** 接続が有効な間だけ設定とファイルの操作を受け付ける。 */
export class SessionOptions extends SessionLifecycle {
	/** ファイル操作の実装は Extension Host の起動時に注入する。 */
	constructor(
		factory: TransportFactory,
		private files?: AttachmentService,
	) {
		super(factory);
	}
	/** サーバーが提示した値だけを送り、応答全体で依存する選択肢も更新する。 */
	protected async setConfig(configId: string, value: string): Promise<void> {
		const option = this.state.configOptions.find(
			(item) => item.id === configId,
		);
		if (
			!this.transport ||
			!this.state.sessionId ||
			this.state.configPending ||
			!option?.options.some((choice) => choice.value === value)
		) {
			throw new Error("Invalid config");
		}
		const epoch = this.epoch;
		this.patch({ configPending: true });
		try {
			const response = await this.transport.setConfig(
				this.state.sessionId,
				configId,
				value,
			);
			if (epoch === this.epoch) {
				this.patch({
					configOptions: configOptions(response.configOptions),
				});
			}
		} finally {
			if (epoch === this.epoch) {
				this.patch({ configPending: false });
			}
		}
	}
	/** 添付済み ID だけを開き、ピッカー終了時にはセッション世代を再検証する。 */
	protected async attachment(
		message: Exclude<ComposerMessage, { type: "config/set" }>,
	): Promise<void> {
		if (!this.files) {
			throw new Error("Files unavailable");
		}
		if (message.type !== "attachment/add") {
			const file = this.state.attachments.find(
				(item) => item.id === message.attachmentId,
			);
			if (!file) {
				throw new Error("Unknown attachment");
			}
			if (message.type === "attachment/open") {
				await this.files.open(file);
			} else {
				this.patch({
					attachments: this.state.attachments.filter(
						(item) => item.id !== file.id,
					),
				});
			}
			return;
		}
		if (this.state.attachmentPending) {
			return;
		}
		const epoch = this.epoch;
		this.patch({ attachmentPending: true });
		try {
			const selected = await this.files.pick();
			if (epoch !== this.epoch) {
				return;
			}
			const files = new Map(
				this.state.attachments.map((file) => [file.uri, file]),
			);
			for (const file of selected) {
				files.set(file.uri, file);
			}
			this.patch({ attachments: [...files.values()] });
		} finally {
			if (epoch === this.epoch) {
				this.patch({ attachmentPending: false });
			}
		}
	}
}
