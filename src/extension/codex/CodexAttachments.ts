// 添付ファイルの選択と寿命を、接続やモデル設定から分離する。
import type { Attachment, ComposerMessage } from "../../shared/composer";
import type { AuthService } from "./AuthFlow";
import type { InteractionService } from "./interactionRequests";
import { CodexLifecycle, type CodexFactory } from "./CodexLifecycle";
/** Hostが選択したファイルだけを扱うサービス境界。 */
export type CodexFiles = {
	pick: () => Promise<Attachment[]>;
	open: (file: Attachment) => Promise<void>;
};

/** 接続世代と会話IDが一致する添付操作だけを許可する。 */
export abstract class CodexAttachments extends CodexLifecycle {
	/** VS Codeサービスを接続と同じ寿命で受け取る。 */
	constructor(
		factory: CodexFactory,
		private readonly files?: CodexFiles,
		auth?: AuthService,
		protected readonly interactions?: InteractionService,
	) {
		super(factory, auth);
	}

	/** 添付は会話と接続世代を照合し、ピッカーを開いている間の切り替えを排除する。 */
	protected async attachment(
		message: Exclude<ComposerMessage, { type: "config/set" }>,
	): Promise<void> {
		if (!this.files || this.busy()) {
			throw new Error("Attachments unavailable");
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
						(item) => item !== file,
					),
				});
			}
			return;
		}
		if (this.state.attachmentPending) {
			return;
		}
		const epoch = this.epoch,
			threadId = this.state.sessionId;
		this.patch({ attachmentPending: true });
		try {
			const selected = await this.files.pick();
			if (epoch !== this.epoch || threadId !== this.state.sessionId) {
				return;
			}
			const files = new Map(
				this.state.attachments.map((item) => [item.uri, item]),
			);
			for (const file of selected) {
				files.set(file.uri, file);
			}
			if (files.size > 20) {
				throw new Error("Too many attachments");
			}
			this.patch({ attachments: [...files.values()] });
		} finally {
			if (epoch === this.epoch) {
				this.patch({ attachmentPending: false });
			}
		}
	}

	protected get supportsAttachments(): boolean {
		return !!this.files;
	}
}
