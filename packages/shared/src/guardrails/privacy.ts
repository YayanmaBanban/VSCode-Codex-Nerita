// 個人情報自体は保存せず、送信前検査の有効設定と検出結果の分類だけを共有する。
import { z } from "zod";

export const privacyConfigSchema = z.strictObject({
	enabled: z.boolean(),
	// モデルは未接続。JSON の直接編集でも、動作しない検査を有効にさせない。
	usePiiModel: z.literal(false),
});
/** ワークスペースの guardrails.json で編集し、保存・適用した設定だけを実行に使う。 */
export type PrivacyConfig = z.infer<typeof privacyConfigSchema>;
/** 検出値や入力のフィールド名は承認画面へ渡さず、この分類だけを通知する。 */
export type PrivacyKind = "email" | "phone" | "identifier";
export const privacyKindLabels: Record<PrivacyKind, string> = {
	email: "メールアドレス",
	phone: "電話番号",
	identifier: "番号・識別情報",
};
