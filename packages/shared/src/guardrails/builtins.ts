// 組み込みの保護対象・表示名・初期判定を共有し、エディターと実行側の分類を揃える。
import { z } from "zod";

export const builtinActionSchema = z.enum(["deny", "ask"]);
export const builtinPathDefinitions = [
	{
		id: "ssh",
		name: "SSH・秘密鍵",
		description: ".ssh 配下、id_rsa・id_ed25519 など",
		patterns: [
			".ssh",
			"**/.ssh/**",
			"id_rsa",
			"id_ed25519",
			"id_dsa",
			"id_ecdsa",
			"id_rsa.pub",
			"id_ed25519.pub",
		],
		exceptions: [],
		defaultAction: "deny",
	},
	{
		id: "aws",
		name: "AWS 認証情報",
		description: ".aws 配下",
		patterns: [".aws", "**/.aws/**"],
		exceptions: [],
		defaultAction: "deny",
	},
	{
		id: "gnupg",
		name: "GnuPG 鍵情報",
		description: ".gnupg 配下",
		patterns: [".gnupg", "**/.gnupg/**"],
		exceptions: [],
		defaultAction: "deny",
	},
	{
		id: "gitCredentials",
		name: "Git 認証情報",
		description: ".git-credentials",
		patterns: [".git-credentials"],
		exceptions: [],
		defaultAction: "deny",
	},
	{
		id: "environment",
		name: "環境変数ファイル",
		description: ".env・.env.*・.envrc（.env.example・.env.sample は除外）",
		patterns: [".env", ".env.*", ".envrc"],
		exceptions: [".env.example", ".env.sample"],
		defaultAction: "deny",
	},
	{
		id: "authConfig",
		name: "認証・パッケージ設定",
		description: "auth.json・.npmrc・.pypirc・.netrc",
		patterns: ["auth.json", ".npmrc", ".pypirc", ".netrc"],
		exceptions: [],
		defaultAction: "ask",
	},
	{
		id: "cloudConfig",
		name: "クラウド・サービス設定",
		description: ".kube/config・GitHub CLI・Google Cloud・Azure の設定",
		patterns: [
			"**/.kube/config",
			"**/.config/gh/hosts.yml",
			"**/.config/gcloud",
			"**/.config/gcloud/**",
			".azure",
			"**/.azure/**",
		],
		exceptions: [],
		defaultAction: "ask",
	},
	{
		id: "keyFiles",
		name: "証明書・鍵・パスワード保管庫",
		description: "*.pem・*.key・*.p12・*.pfx・*.kdbx",
		patterns: ["*.pem", "*.key", "*.p12", "*.pfx", "*.kdbx"],
		exceptions: [],
		defaultAction: "ask",
	},
] as const;

export const builtinCommandDefinitions = [
	{
		id: "git",
		name: "Git の破壊的操作",
		description: "履歴・変更の破棄、強制 push、ブランチやタグの削除",
		defaultAction: "ask",
	},
	{
		id: "filesystem",
		name: "ファイルの削除・上書き",
		description: "rm・Remove-Item・truncate・ディスク初期化など",
		defaultAction: "ask",
	},
	{
		id: "containers",
		name: "コンテナー・ボリュームの削除",
		description: "Docker／Podman の rm・prune・compose down -v",
		defaultAction: "ask",
	},
	{
		id: "packages",
		name: "パッケージの削除",
		description: "npm・pnpm・pip などの remove／uninstall",
		defaultAction: "ask",
	},
	{
		id: "system",
		name: "システム・権限の変更",
		description: "sudo・停止・再起動・プロセス終了・権限変更など",
		defaultAction: "ask",
	},
	{
		id: "database",
		name: "データベースの破壊的操作",
		description: "DROP・TRUNCATE・DELETE・UPDATE など",
		defaultAction: "ask",
	},
	{
		id: "secrets",
		name: "シェルからの機密ファイル参照",
		description:
			"機密ファイル名を含むコマンド。変数・スクリプト内部は完全には解析しません。",
		defaultAction: "ask",
	},
] as const;

export const builtinRulesSchema = z.strictObject({
	paths: z.record(
		z.enum(builtinPathDefinitions.map((definition) => definition.id)),
		builtinActionSchema,
	),
	commands: z.record(
		z.enum(builtinCommandDefinitions.map((definition) => definition.id)),
		builtinActionSchema,
	),
});
/** 組み込み保護は無効化せず、拒否または承認に限定する。 */
export type BuiltinRules = z.infer<typeof builtinRulesSchema>;

/** 初期判定は一覧の定義を基準に作り、未知の項目や許可値を持ち込まない。 */
export function defaultBuiltinRules(): BuiltinRules {
	return builtinRulesSchema.parse({
		paths: Object.fromEntries(
			builtinPathDefinitions.map((definition) => [
				definition.id,
				definition.defaultAction,
			]),
		),
		commands: Object.fromEntries(
			builtinCommandDefinitions.map((definition) => [
				definition.id,
				definition.defaultAction,
			]),
		),
	});
}
