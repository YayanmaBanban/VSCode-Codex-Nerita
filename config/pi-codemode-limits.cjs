// 固定 SDK の収集処理に上限を設け、スクリプトから変更できない制約として配布する。
const { replaceRequired } = require("./pi-bundle-plugin.cjs");

/** Worker のメッセージを蓄積する前に、入力・出力・子呼出しを制限する。 */
function limitHost(source) {
	let result = replaceRequired(
		source,
		"output = [];",
		"output = [];\n    outputChars = 0;\n    callCount = 0;",
	);
	result = replaceRequired(
		result,
		"switch (message.type) {",
		`
        const size = JSON.stringify(message).length;
        if (size > 262144) {
            this.finish({ kind: "sandbox", message: "Codemode message exceeds 262144 characters" });
            return;
        }
        if (message.type === "output") {
            this.outputChars += JSON.stringify(message.item).length;
            if (this.outputChars > 32768 || this.output.length >= 128) {
                this.finish({ kind: "sandbox", message: "Codemode output exceeds 32768 characters or 128 items" });
                return;
            }
        }
        if (message.type === "call") {
            if (++this.callCount > 32 || this.pending.size >= 4 || (message.args?.length ?? 0) > 65536) {
                this.finish({ kind: "sandbox", message: "Codemode calls exceed 32 calls, 4 concurrent calls or 65536 argument characters" });
                return;
            }
        }
        if (message.type === "done" && message.ok && ((message.value?.length ?? 0) + this.outputChars > 32768 || message.writes.length > 65536)) {
            this.finish({ kind: "sandbox", message: "Codemode return or store exceeds its limit" });
            return;
        }
        switch (message.type) {`,
	);
	result = replaceRequired(
		result,
		"this.post(reply);",
		`if ((reply.payload?.length ?? 0) > 262144) {
            this.finish({ kind: "sandbox", message: "Codemode nested result exceeds 262144 characters" });
            return;
        }
        this.post(reply);`,
	);
	return result;
}

/** VM 内でも出力を制限し、Host のメッセージ待ち行列へ無制限に送らせない。 */
function limitPrelude(source) {
	let result = replaceRequired(source, "256 * 1024", "16 * 1024");
	result = replaceRequired(result, "1024 * 1024", "64 * 1024");
	result = replaceRequired(
		result,
		"let nextId = 1;",
		"let nextId = 1;\n\tlet outputChars = 0;\n\tlet outputItems = 0;",
	);
	result = replaceRequired(
		result,
		'bridge("output", "text", rendered);',
		'emit("text", rendered);',
	);
	result = replaceRequired(
		result,
		'bridge("output", "text", args.map(format).join(" "));',
		'emit("text", args.map(format).join(" "));',
	);
	result = replaceRequired(
		result,
		"function text(value) {",
		`function emit(kind, data, mimeType) {
        outputChars += data.length;
        if (++outputItems > 128 || outputChars > 32768) throw new ErrorCtor("Codemode output limit exceeded");
        bridge("output", kind, data, mimeType);
    }
    function text(value) {`,
	);
	result = replaceRequired(
		result,
		'checkKey("store", key);',
		`checkKey("store", key);
        if (key.length > 256 || (!writes.has(key) && writes.size >= 128)) throw new ErrorCtor("Codemode store key limit exceeded");`,
	);
	// 画像も同じ総量を消費し、大きな base64 を Host へ送り続けられないようにする。
	result = result.replace(
		/bridge\("output", "image", ([^;]+)\);/g,
		'emit("image", $1);',
	);
	return result;
}

/** SDK の実行オプションによる制限解除と、全出力の一時ファイル保存を防ぐ。 */
function limitExecutor(source) {
	let result = replaceRequired(
		source,
		"store.set(key, value);",
		`{
            if (key.length > 256 || JSON.stringify(value).length > 16384) throw new Error("Codemode stored value exceeds its limit");
            store.set(key, value);
            if (store.size > 128 || JSON.stringify(Object.fromEntries(store)).length > 65536) throw new Error("Codemode stored snapshot exceeds its limit");
        }`,
	);
	result = replaceRequired(
		result,
		"sourceOptions.timeoutMs ?? Number.POSITIVE_INFINITY",
		"Math.min(sourceOptions.timeoutMs ?? 60000, 60000)",
	);
	result = replaceRequired(
		result,
		"sourceOptions.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS",
		"Math.min(sourceOptions.maxOutputTokens ?? 8192, 8192)",
	);
	result = replaceRequired(
		result,
		"await spillOutput(combined)",
		'({ error: "Output omitted by Host policy; no file was written" })',
	);
	return result;
}

/** SDK と VM の対象ファイルだけを変換する。 */
async function codemodeContents(file, sdkFile, aiFile) {
	const normalized = file.replaceAll("\\", "/");
	let transform;
	if (/\/pi-codemode\/dist\/runtime\/host\.js$/.test(normalized)) {
		transform = limitHost;
	}
	if (/\/pi-codemode\/dist\/runtime\/prelude-source\.js$/.test(normalized)) {
		transform = limitPrelude;
	}
	if (sdkFile === "dist/extensions/codemode/execute.js") {
		transform = limitExecutor;
	}
	if (sdkFile === "dist/core/sdk.js") {
		transform = limitSessionOptions;
	}
	if (sdkFile === "dist/core/agent-session.js") {
		transform = limitSessionRegistry;
	}
	if (sdkFile === "dist/extensions/codemode/tool.js") {
		transform = limitDocumentation;
	}
	if (aiFile === "dist/api/openai-responses.js") {
		transform = localSearchProtocol;
	}
	return transform
		? transform(await require("node:fs/promises").readFile(file, "utf8"))
		: undefined;
}

/** 定義の追加通知は ChatGPT OAuth に限定し、API Key では通常の function 宣言を使う。 */
function localSearchProtocol(source) {
	return replaceRequired(
		source,
		"const compat = getCompat(model);",
		`const compat = {
                ...getCompat(model),
                supportsAdditionalTools: isChatGPTSignIn(model, apiKey) && getCompat(model).supportsAdditionalTools,
                supportsToolSearch: false,
            };`,
	);
}

/** 初期の表示対象を登録の許可リストから分離し、検索で定義を追加できるようにする。 */
function limitSessionOptions(source) {
	let result = replaceRequired(
		source,
		"const initialActiveToolNames = (options.tools ??",
		"const initialActiveToolNames = (options.neritaActiveToolNames ?? options.tools ??",
	);
	return replaceRequired(
		result,
		"        allowedToolNames,",
		"        allowedToolNames,\n        neritaAllowedToolNames: options.neritaAllowedToolNames,",
	);
}

/** Host が検証した動的登録だけを、既存の SDK の許可判定へ追加する。 */
function limitSessionRegistry(source) {
	return replaceRequired(
		source,
		"this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;",
		"this._allowedToolNames = config.neritaAllowedToolNames ?? (config.allowedToolNames ? new Set(config.allowedToolNames) : undefined);",
	);
}

/** Pi 1.0 の短縮された説明にも、Host が強制する固定上限を明記する。 */
function limitDocumentation(source) {
	return replaceRequired(
		source,
		'// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}\\`',
		'// @options: {"max_output_tokens": 8192, "timeout_ms": 60000}\\`\n- Output defaults to 8192 tokens and cannot exceed 8192 tokens or 32768 output characters. The Host enforces a 60000 ms deadline including approval. At most 32 calls, 4 concurrent calls, 65536 input bytes, 128 output items and 65536 stored JSON characters are allowed. Stored values are limited to 16384 characters and 128 keys. Options cannot raise these limits.',
	);
}
module.exports = { limitHost, limitPrelude, limitExecutor, codemodeContents };
