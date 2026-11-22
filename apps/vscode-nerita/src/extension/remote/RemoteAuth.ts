// ペアリングとメモリ内の単一ブラウザーセッションを管理する。
import {
	createHash,
	randomBytes,
	randomInt,
	timingSafeEqual,
} from "node:crypto";
import { pairingLifetimeMs } from "@nerita/shared/remote/workspaceControls";
import { RemoteError } from "./RemoteError";

const cookieName = "__Host-nerita";
const cookie = `${cookieName}=`;
const cookieFlags = "; HttpOnly; Secure; SameSite=Strict; Path=/";
const sessionSeconds = 12 * 60 * 60;
const idleMs = 30 * 60 * 1000;
const cooldownMs = 60 * 1000;
const replayMs = 5 * 60 * 1000;

/** ブラウザーごとの期限・照合情報と重複リクエストの記録。 */
type RemoteSession = {
	digest: Buffer;
	csrf: string;
	expires: number;
	idleUntil: number;
	requests: Map<string, number>;
};

/** 照合に使う値を固定長のダイジェストにする。 */
const digest = (value: string) => createHash("sha256").update(value).digest();

/** 発行コードとブラウザートークンをハッシュで保持する。 */
export class RemoteAuth {
	private session: RemoteSession | undefined;
	private expiryTimer: ReturnType<typeof setTimeout> | undefined;
	private code:
		{ digest: Buffer; expires: number; failures: number } | undefined;
	private cooldownUntil = 0;

	/** 失効時に呼び出し側が SSE をすぐ閉じられるようにする。 */
	constructor(
		private readonly onRevoke: () => void,
		private readonly now = Date.now,
	) {}

	/** 古いコードを上書きし、最新の一件だけを有効にする。 */
	issueCode(): string {
		if (this.now() < this.cooldownUntil) {
			throw new RemoteError("too_many_requests");
		}
		const code = randomInt(100_000_000).toString().padStart(8, "0");
		this.code = {
			digest: digest(code),
			expires: this.now() + pairingLifetimeMs,
			failures: 0,
		};
		return code;
	}

	/** 未使用のコードを無効にする。 */
	cancelPairing(): void {
		this.code = undefined;
	}

	/** 一度限りのコードを検証し、旧ブラウザーの認証を失効させる。 */
	pair(code: string): string {
		const now = this.now();
		if (now < this.cooldownUntil) {
			throw new RemoteError("too_many_requests");
		}
		const pending = this.code;
		if (!pending || now >= pending.expires) {
			this.code = undefined;
			throw new RemoteError("unauthenticated");
		}
		if (!timingSafeEqual(pending.digest, digest(code))) {
			pending.failures++;
			if (pending.failures >= 5) {
				this.code = undefined;
				this.cooldownUntil = now + cooldownMs;
				throw new RemoteError("too_many_requests");
			}
			throw new RemoteError("unauthenticated");
		}
		this.revoke();
		const token = randomBytes(32).toString("hex");
		this.session = {
			digest: digest(token),
			csrf: randomBytes(32).toString("hex"),
			expires: now + sessionSeconds * 1000,
			idleUntil: now + idleMs,
			requests: new Map(),
		};
		this.scheduleExpiry(this.session);
		return `${cookie}${token}${cookieFlags}; Max-Age=${sessionSeconds}`;
	}

	/** ブラウザーに保存されたトークンを削除する。 */
	clearCookie(): string {
		return `${cookie}${cookieFlags}; Max-Age=0`;
	}

	/** 現在の有効な Cookie だけを受理する。 */
	authenticate(header: string | undefined): RemoteSession {
		const values =
			header
				?.split(";")
				.map((part) => part.trim())
				.filter((part) => part.startsWith(cookie)) ?? [];
		const value =
			values.length === 1 ? values[0]?.slice(cookie.length) : undefined;
		const session = this.session;
		const validToken = value !== undefined && /^[a-f0-9]{64}$/u.test(value);
		if (!session || !this.active(session) || !validToken) {
			throw new RemoteError("unauthenticated");
		}
		if (!timingSafeEqual(session.digest, digest(value))) {
			throw new RemoteError("unauthenticated");
		}
		return session;
	}

	/** POST トークンを現在のセッションに照合する。 */
	verifyCsrf(
		session: RemoteSession,
		value: string | string[] | undefined,
	): void {
		const validToken =
			typeof value === "string" && value.length === session.csrf.length;
		const matches =
			validToken && timingSafeEqual(digest(value), digest(session.csrf));
		if (!matches) {
			throw new RemoteError("csrf_invalid");
		}
	}

	/** 失効済みの認証を処理途中でも検出する。 */
	active(session: RemoteSession): boolean {
		if (this.session !== session) {
			return false;
		}
		if (this.now() >= Math.min(session.expires, session.idleUntil)) {
			this.expireSession();
			return false;
		}
		return true;
	}

	/** 重複を検査し、明示操作だけ無操作期限を延長する。 */
	claim(session: RemoteSession, requestId: string): void {
		if (!this.active(session)) {
			throw new RemoteError("unauthenticated");
		}
		const now = this.now();
		for (const [id, expires] of session.requests) {
			if (expires > now) {
				break;
			}
			session.requests.delete(id);
		}
		if (session.requests.has(requestId)) {
			throw new RemoteError("stale_session");
		}
		if (session.requests.size >= 256) {
			throw new RemoteError("too_many_requests");
		}
		session.requests.set(requestId, now + replayMs);
		session.idleUntil = now + idleMs;
		this.scheduleExpiry(session);
	}

	/** 端末と発行済みペアリングコードをすべて失効させる。 */
	revoke(): void {
		this.code = undefined;
		this.expireSession();
	}

	/** ブラウザーだけを失効させ、発行直後のコードは期限まで有効にする。 */
	private expireSession(): void {
		this.session = undefined;
		clearTimeout(this.expiryTimer);
		this.onRevoke();
	}

	/** 通信がなくても期限到達時に SSE を切断する。 */
	private scheduleExpiry(session: RemoteSession): void {
		clearTimeout(this.expiryTimer);
		const remaining =
			Math.min(session.expires, session.idleUntil) - this.now();
		this.expiryTimer = setTimeout(() => {
			if (this.active(session)) {
				this.scheduleExpiry(session);
			}
		}, remaining);
		this.expiryTimer.unref();
	}
}
