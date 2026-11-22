// PC の Webview だけで使うリモート接続設定と操作。
import { z } from "zod";

/** Host の認証期限と PC の残り時間表示で共有する。 */
export const pairingLifetimeMs = 120_000;

const requestId = z.string().min(1).max(256);
const hostname = z.string().max(253);
const pairingCode = z.string().regex(/^\d{8}$/u);

export const remoteWorkspaceStateSchema = z.strictObject({
	phase: z.enum(["off", "starting", "on", "stopping"]),
	connected: z.boolean(),
	hostname,
	pairingCode: pairingCode.nullable(),
	pairingExpiresAt: z.int().positive().nullable(),
	error: z.string().max(512).nullable(),
});

/** ホスト名と一時コードは PC の設定カードにだけ通知する。 */
export type RemoteWorkspaceState = z.infer<typeof remoteWorkspaceStateSchema>;

export const remoteWorkspaceActionSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("ui/remoteStart"), requestId, hostname }),
	z.strictObject({ type: z.literal("ui/remoteStop"), requestId }),
	z.strictObject({ type: z.literal("ui/remotePair"), requestId }),
	z.strictObject({
		type: z.literal("ui/remoteDismissPairing"),
		requestId,
		code: pairingCode,
	}),
	z.strictObject({ type: z.literal("ui/remoteRevoke"), requestId }),
]);

/** 鍵や Tailscale の CLI 引数を Webview から受け取らない。 */
export type RemoteWorkspaceAction = z.infer<typeof remoteWorkspaceActionSchema>;
