// 正規表現による検出、送信ごとの確認、ガードレール適用・停止後の拒否と実際の HTTP 送信を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import type { PermissionPresentation } from "@nerita/shared/permission";
import {
	defaultGuardrails,
	parseGuardrails,
} from "@nerita/shared/guardrails/config";
import { PiPrivacyError } from "../../apps/vscode-nerita/src/extension/backends/pi/guardrails/PiEgressGuard";
import { fetchPiMcpRequest } from "../../apps/vscode-nerita/src/extension/backends/pi/guardrails/PiEgressHttp";
import { privacyFixture } from "../support/piPrivacy";

void test("未接続の PII モデルと個人情報の登録値は設定ファイルから有効にできない", () => {
	const config = defaultGuardrails();
	assert.throws(() =>
		parseGuardrails(
			JSON.stringify({
				...config,
				privacy: { ...config.privacy, usePiiModel: true },
			}),
		),
	);
	assert.throws(() =>
		parseGuardrails(
			JSON.stringify({
				...config,
				privacy: { ...config.privacy, entries: ["private-person"] },
			}),
		),
	);
});

void test("個人情報のない入力は追加確認せず送信する", async () => {
	const f = privacyFixture();
	let approvals = 0;
	const output = await f.guard.run(
		{ query: "public documentation" },
		"Web ツール",
		() => {
			approvals++;
			return Promise.resolve(new AbortController().signal);
		},
		new AbortController().signal,
		(snapshot) => Promise.resolve(snapshot),
	);
	assert.equal(approvals, 0);
	assert.deepEqual(output, { query: "public documentation" });
});

void test("適用済みガードレールで保護を無効にした場合だけ追加確認を省く", async () => {
	const f = privacyFixture();
	f.apply({ enabled: false, usePiiModel: false });
	let approvals = 0;
	const input = { query: "person@example.invalid" };
	const output = await f.guard.run(
		input,
		"Web 検索",
		() => {
			approvals++;
			return Promise.resolve(new AbortController().signal);
		},
		new AbortController().signal,
		(snapshot) => Promise.resolve(snapshot),
	);
	assert.equal(approvals, 0);
	assert.deepEqual(output, input);
});

for (const [label, contentType, body] of [
	["バイナリー", "application/octet-stream", "binary"],
	["巨大本文", "text/plain", "x".repeat(65537)],
] as const) {
	void test(`検査できない ${label} を HTTP 送信する前に拒否する`, async () => {
		const f = privacyFixture();
		let approvals = 0;
		const request = new Request("http://127.0.0.1:9/", {
			method: "POST",
			headers: { "content-type": contentType },
			body,
		});
		await assert.rejects(
			fetchPiMcpRequest(
				request,
				() => {
					approvals++;
					return Promise.resolve(new AbortController().signal);
				},
				new AbortController().signal,
				f.guard,
			),
			PiPrivacyError,
		);
		assert.equal(approvals, 0);
	});
}

void test("検索サービスの送信先が不明な個人情報入り検索語は例外を許可しない", async () => {
	const f = privacyFixture();
	let approvals = 0;
	let sent = false;
	await assert.rejects(
		f.guard.run(
			{ query: "person@example.invalid" },
			"Web 検索",
			() => {
				approvals++;
				return Promise.resolve(new AbortController().signal);
			},
			new AbortController().signal,
			() => {
				sent = true;
				return Promise.resolve();
			},
		),
		PiPrivacyError,
	);
	assert.equal(approvals, 0);
	assert.equal(sent, false);
});

void test("符号化された個人情報の送信を止め、今回の許可を次の呼出しに再利用しない", async () => {
	const f = privacyFixture();
	const input = {
		url: `https://example.invalid/?address=${encodeURIComponent(encodeURIComponent("person@example.invalid"))}`,
	};
	let approvals = 0;
	let sent = 0;
	const authorize = (request: PermissionPresentation) => {
		approvals++;
		assert.equal(sent, approvals - 1);
		assert.ok(!JSON.stringify(request).includes("person@example.invalid"));
		assert.ok(!JSON.stringify(request).includes(input.url));
		if (approvals === 2) {
			return Promise.reject(new Error("declined"));
		}
		return Promise.resolve(new AbortController().signal);
	};
	const send = () => {
		sent++;
		return Promise.resolve();
	};
	await f.guard.run(
		input,
		"Web ツール",
		authorize,
		new AbortController().signal,
		send,
	);
	await assert.rejects(
		f.guard.run(
			input,
			"Web ツール",
			authorize,
			new AbortController().signal,
			send,
		),
	);
	assert.equal(approvals, 2);
	assert.equal(sent, 1);
});

void test("承認中に呼出し側の入力が変わっても検査したコピーだけを送る", async () => {
	const f = privacyFixture();
	const input = { query: "person@example.invalid" };
	const output = await f.guard.run(
		input,
		"Web ツール",
		(request) => {
			assert.ok(!JSON.stringify(request).includes(input.query));
			input.query = "changed@example.invalid";
			return Promise.resolve(new AbortController().signal);
		},
		new AbortController().signal,
		(snapshot) => Promise.resolve(snapshot),
	);
	assert.deepEqual(output, { query: "person@example.invalid" });
});

void test("個人情報の承認待ちに設定を変更すると送信しない", async () => {
	const f = privacyFixture();
	let sent = false;
	await assert.rejects(
		f.guard.run(
			{ query: "person@example.invalid" },
			"Web ツール",
			() => {
				f.apply({ enabled: false, usePiiModel: false });
				return Promise.resolve(new AbortController().signal);
			},
			new AbortController().signal,
			() => {
				sent = true;
				return Promise.resolve();
			},
		),
	);
	assert.equal(sent, false);
});

void test("停止後に遅れて許可されても送信しない", async () => {
	const f = privacyFixture();
	const controller = new AbortController();
	let sent = false;
	await assert.rejects(
		f.guard.run(
			{ query: "person@example.invalid" },
			"Web ツール",
			() => {
				controller.abort();
				return Promise.resolve(new AbortController().signal);
			},
			controller.signal,
			() => {
				sent = true;
				return Promise.resolve();
			},
		),
	);
	assert.equal(sent, false);
});

for (const location of ["url", "header", "body"] as const) {
	void test(`HTTP の ${location} の個人情報を拒否するとサーバーへ届かない`, async (t) => {
		const f = privacyFixture();
		const requests: string[] = [];
		const server = createServer((request, response) => {
			requests.push(request.url ?? "");
			response.end("ok");
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		t.after(() => {
			server.closeAllConnections();
			server.close();
		});
		const address = server.address();
		assert.ok(address !== null && typeof address !== "string");
		const url = `http://127.0.0.1:${address.port}/`;
		await fetchPiMcpRequest(
			new Request(url, { redirect: "error" }),
			() => Promise.reject(new Error("unexpected")),
			new AbortController().signal,
			f.guard,
		);
		assert.equal(
			requests.length,
			1,
			"保護を接続した経路で正常な通信が成立する",
		);
		const email = "person@example.invalid";
		const request = new Request(
			location === "url" ? `${url}?q=${encodeURIComponent(email)}` : url,
			{
				method: "POST",
				redirect: "error",
				headers: {
					"content-type": "application/json",
					"x-contact": location === "header" ? email : "public",
				},
				body: JSON.stringify({
					query:
						location === "body"
							? email.replace("@", "\\u0040")
							: "public",
				}),
			},
		);
		let approvals = 0;
		await assert.rejects(
			fetchPiMcpRequest(
				request,
				() => {
					approvals++;
					return Promise.reject(new Error("declined"));
				},
				new AbortController().signal,
				f.guard,
			),
		);
		assert.equal(approvals, 1);
		assert.equal(requests.length, 1, "拒否した HTTP 要求を送信しない");
	});
}

void test("適用済み設定の復元に失敗した場合は送信を拒否する", async () => {
	const f = privacyFixture();
	f.registry.block(f.root);
	let sent = false;
	await assert.rejects(
		f.guard.run(
			{},
			"Web ツール",
			() => Promise.resolve(new AbortController().signal),
			new AbortController().signal,
			() => {
				sent = true;
				return Promise.resolve();
			},
		),
		PiPrivacyError,
	);
	assert.equal(sent, false);
});

for (const [label, input] of [
	["メール", { q: "検証用：ｐｅｒｓｏｎ＠ｅｘａｍｐｌｅ．ｉｎｖａｌｉｄ" }],
	["携帯電話", { q: "連絡先 090-1234-5678" }],
	["固定電話", { q: "連絡先 (03) 1234-5678" }],
	["国際電話", { q: "連絡先 +81 90 1234 5678" }],
	["カード番号", { q: "4111 1111 1111 1111" }],
	["マイナンバー", { q: "個人番号: 1234-5678-9012" }],
	["免許証番号", { q: "運転免許証番号: 123456789012" }],
	["旅券番号", { q: "パスポート番号: AB1234567" }],
	["口座番号", { q: "口座番号: 1234567" }],
	["構造化した社員番号", { employee_id: "AB-1234" }],
	["数値型の学籍番号", { 学籍番号: 12345678 }],
] as const) {
	void test(`正規表現で検出した${label}は拒否すると送信しない`, async () => {
		const f = privacyFixture();
		let approvals = 0;
		let sent = false;
		await assert.rejects(
			f.guard.run(
				input,
				"Web ツール",
				() => {
					approvals++;
					return Promise.reject(new Error("declined"));
				},
				new AbortController().signal,
				() => {
					sent = true;
					return Promise.resolve();
				},
			),
			PiPrivacyError,
		);
		assert.equal(approvals, 1, "番号類も送信前の確認が必要");
		assert.equal(sent, false);
	});
}

for (const input of [
	{ q: "version 2026.11.07 / 202611071234 / 42 / item-1234567" },
	{ q: "card 4111 1111 1111 1112" },
	{ q: "電話ではない数列 123456789012345678901" },
	{ q: "山田太郎の住所は東京都架空区です" },
] as const) {
	void test(`追加モデル未接続時は正規表現に一致しない入力を送信する: ${input.q}`, async () => {
		const f = privacyFixture();
		const result = await f.guard.run(
			input,
			"Web ツール",
			() => Promise.reject(new Error("unexpected approval")),
			new AbortController().signal,
			(snapshot) => Promise.resolve(snapshot),
		);
		assert.deepEqual(result, input);
	});
}
