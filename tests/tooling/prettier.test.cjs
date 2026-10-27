// 実際の Prettier 設定で、詰まった Svelte の分岐の整形とインラインの保持を検証する。
const assert = require("node:assert/strict");
const { test } = require("node:test");
const prettier = require("prettier");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");

const { compile } = createRequire(
	resolve(__dirname, "../../apps/nerita-ui/package.json"),
)("svelte/compiler");

async function format(source) {
	const filepath = "apps/nerita-ui/src/Example.svelte";
	const config = await prettier.resolveConfig(filepath);
	return prettier.format(source, { ...config, filepath });
}

test("連続する分岐・コンポーネントを改行し、再整形しても変わらない", async () => {
	const result = await format(
		"<main>{#if ready}{#key revision}{#if mode}<First />{:else}<Second />{/if}{/key}{:else}<Footer />{/if}</main>",
	);
	assert.match(result, /\{#if ready\}\n\t\t\{#key revision\}\n/);
	assert.match(result, /\{:else\}\n\t+<Second \/>\n\t+\{\/if\}/);
	assert.match(result, /\{:else\}\n\t+<Footer \/>\n/);
	assert.equal(await format(result), result);
});

test("ループ・await・snippet の境界を改行する", async () => {
	const result = await format(
		"<main>{#each items as item (item.id)}<Row {item} />{:else}<Empty />{/each}{#await promise}<Pending />{:then value}<Result {value} />{:catch error}<Failure {error} />{/await}{#snippet children()}<Child />{/snippet}</main>",
	);
	assert.match(result, /\{#each[^\n]+\}\n\t+<Row/);
	assert.match(result, /\{:then value\}\n\t+<Result/);
	assert.match(result, /\{:catch error\}\n\t+<Failure/);
	assert.match(result, /\{#snippet children\(\)\}\n\t+<Child/);
	assert.equal(await format(result), result);
});

test("アイコンだけのボタンは開始タグ・子要素・終了タグを別行にする", async () => {
	const result = await format(
		'<button {...props} type="button" class={iconButtonStyle} disabled={busy} aria-label="再読み込み" onclick={() => send({ type: "refresh" })}><RotateCw size={15} aria-hidden="true" /></button>',
	);
	assert.match(result, /\n>\n\t<RotateCw[^\n]+\/>\n<\/button>/);
	assert.equal(await format(result), result);
});

test("span などの要素を列挙せず、長い開始タグと本文・終了タグを別行にする", async () => {
	for (const tag of ["span", "a", "mark", "custom-label"]) {
		const source = `<${tag} class="min-w-0 break-words" aria-label="選択した項目を表示するための十分に長い属性値">{selectedAgent.name}</${tag}>`;
		const result = await format(source);
		assert.ok(result.includes(`>\n\t{selectedAgent.name}\n</${tag}>`), tag);
		assert.equal(await format(result), result, tag);
	}
});

test("文章・隣接要素・式の間隔と option の値を整形前後で保持する", async () => {
	const cases = [
		"<p>before<span>middle</span>after</p>",
		"<div><span>A</span><span>B</span></div>",
		"<button><Icon /><span>{label}</span></button>",
		"<span>{stage.id} {stage.name}</span>",
		"<span>{count} 件</span>",
		"<select>{#each values as value (value)}<option>{value}</option>{/each}</select>",
		'<span>{#if kind === "first"}<First />{:else if kind === "second"}<Second />{:else}<Other />{/if}</span>',
	];
	for (const source of cases) {
		const result = await format(source);
		const options = {
			filename: "Example.svelte",
			dev: false,
			css: "external",
		};
		assert.equal(
			compile(result, options).js.code,
			compile(source, options).js.code,
			source,
		);
		assert.equal(await format(result), result, source);
	}
});

test("文章中の分岐・隣接するインライン要素・属性・空白保持要素は変更しない", async () => {
	const source =
		'<p>before{#if ok}<Icon />{:else}<Other />{/if}after<span>A</span><span>B</span></p>\n<pre>{#if ok}<Icon />{/if}  x\n y</pre>\n<textarea>  hello\nworld</textarea>\n<div title="a{value}b"></div>';
	const result = await format(source);
	assert.match(
		result,
		/before\{#if ok\}<Icon \/>\{:else\}<Other \/>\{\/if\}after/,
	);
	assert.match(result, /A<\/span><span>B/);
	assert.match(result, /<pre>\{#if ok\}<Icon \/>\{\/if\} {2}x\n y<\/pre>/);
	assert.match(result, /<textarea> {2}hello\nworld<\/textarea\s*>/);
	assert.match(result, /title="a\{value\}b"/);
	assert.equal(await format(result), result);
});

test("ボタン内の文言・式・隣接要素の間には改行を補わない", async () => {
	const result = await format(
		"<button><Icon />保存</button>\n<button><Icon />{label}</button>\n<button>before{#if ok}<Icon />{:else}<Other />{/if}after</button>\n<button><Icon /><span>{label}</span></button>",
	);
	assert.match(result, /<button><Icon \/>保存<\/button>/);
	assert.match(result, /<button><Icon \/>\{label\}<\/button>/);
	assert.match(result, /<Icon \/><span>\{label\}<\/span>/);
	assert.match(
		result,
		/before\{#if ok\}<Icon \/>\{:else\}<Other \/>\{\/if\}after/,
	);
	assert.equal(await format(result), result);
});

test("prettier-ignore の対象と子孫を維持する", async () => {
	const source =
		"<!-- prettier-ignore -->\n<main>{#if ok}<First/>{:else}<Second/>{/if}</main>";
	assert.equal((await format(source)).trim(), source);
});

test("script/style の先頭コメントと Tailwind の並べ替えを維持する", async () => {
	const source =
		'<!-- script explanation -->\n<script>let ready = true;</script>\n<main>{#if ready}<First class="p-2 flex" />{/if}</main>\n<!-- style explanation -->\n<style>main { color: red; }</style>';
	const result = await format(source);
	assert.match(result, /<!-- script explanation -->\n<script>/);
	assert.match(result, /<!-- style explanation -->\n<style>/);
	assert.match(result, /class="flex p-2"/);
	assert.match(result, /\{#if ready\}\n\t+<First/);
	assert.equal(await format(result), result);
});
