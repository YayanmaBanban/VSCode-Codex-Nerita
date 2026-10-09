// 正当な状態更新の記録は Host の保存領域に置き、ワークスペース内の JSON 自己申告を信頼しない。
import { z } from "zod";
import { DigestSchema } from "@nerita/dlc/workspace";

export const AuthorityRecordSchema = z.strictObject({
	revision: z.number().int().nonnegative(),
	digest: DigestSchema,
	operationId: z.uuid(),
	metadataDigest: DigestSchema,
	ownerProcessId: z.number().int().positive().optional(),
});
export type AuthorityRecord = z.infer<typeof AuthorityRecordSchema>;

/** 保存先の例は VS Code の `globalState`。管理ファイルやエージェントが注入できる値を使わない。 */
export type IntentAuthority = {
	read(key: string): unknown;
	write(key: string, value: AuthorityRecord): Promise<void>;
};
