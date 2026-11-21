// 構成案と審査結果の JSON から、ローカルで開ける比較ページを作る。
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const inputPath = process.argv[2];
assert.ok(inputPath, "使い方: node render-outline-arena.mjs <比較ディレクトリ>/arena.json");

const data = JSON.parse(await readFile(inputPath, "utf8"));
const directory = dirname(inputPath);
assert.deepEqual(data.candidates.map((candidate) => candidate.id), ["A", "B", "C"]);

const pageStyle = `
:root {
	color-scheme: light;
	font-family: "Yu Gothic UI", "Meiryo", sans-serif;
	color: #24332c;
	background: #f5f6f2;
	line-height: 1.65;
}
* { box-sizing: border-box; }
body { margin: 0; overflow-wrap: anywhere; }
main { inline-size: min(100% - 2rem, 86rem); margin-inline: auto; padding-block: 2rem 3rem; }
header { border-inline-start: 4px solid #23614a; padding-inline-start: 1rem; }
h1, h2, h3, h4 { margin-block: 0 .65rem; line-height: 1.35; }
h1 { font-size: clamp(1.6rem, 3.3vw, 2.65rem); }
h2 { font-size: 1.35rem; }
h3 { font-size: 1.2rem; }
h4 { margin-block-start: 1.15rem; font-size: 1rem; }
p { margin-block: .5rem 1rem; }
a { color: #155d47; text-underline-offset: .2em; }
a:focus-visible, summary:focus-visible { outline: 3px solid #155d47; outline-offset: 3px; }
.approval { margin-block: 1.65rem; padding: 1.15rem; background: #e7efe6; border: 1px solid #a8bfae; border-radius: .55rem; }
.approval p:last-child { margin-block-end: 0; }
.choices { display: flex; flex-wrap: wrap; gap: .55rem; padding: 0; margin-block: .75rem; list-style: none; }
.choices code { display: block; padding: .2rem .65rem; color: #173f31; background: #fff; border: 1px solid #afc2b6; border-radius: .35rem; }
.candidates { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; }
.candidate { min-inline-size: 0; padding: 1.15rem; background: #fff; border: 1px solid #ccd6cd; border-block-start: 4px solid #23614a; border-radius: .55rem; }
.letter { display: inline-block; padding: .05rem .48rem; border-radius: .25rem; background: #e7efe6; color: #173f31; }
.audience { font-size: .95rem; }
blockquote { margin: 0; padding: .55rem .85rem; border-inline-start: 3px solid #8eaaa0; background: #f3f6f4; }
ol { padding-inline-start: 1.3rem; }
ol li { margin-block-end: .55rem; }
.claim { display: block; }
details { padding: .6rem .8rem; border: 1px solid #ccd6cd; border-radius: .35rem; }
summary { cursor: pointer; color: #155d47; }
.review { margin-block-start: 1.3rem; padding-block-start: .2rem; border-block-start: 1px solid #ccd6cd; }
dl { margin-block-end: 0; }
dt { font-size: .95rem; font-weight: 700; margin-block-start: .7rem; color: #214e3c; }
dd { margin-inline-start: 0; }
.data-link { margin-block-start: 1.2rem; }
`;

const page = renderPage(data, encodeURIComponent(basename(inputPath)));
const outputPath = join(directory, "index.html");
await writeFile(outputPath, page, "utf8");
console.log(outputPath);

function escapeHtml(value) {
	assert.equal(typeof value, "string", "比較データの本文は文字列で指定してください");
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function renderCandidate(candidate) {
	const { id, title, summary, audience, opening, sections, diagrams, example, foldedDetails, tradeoff, review } = candidate;
	assert.ok(Array.isArray(sections) && sections.length > 0, "各案に見出しと要点を指定してください");
	const outline = sections.map(({ heading, claim }) => `<li><strong>${escapeHtml(heading)}</strong><span class="claim">${escapeHtml(claim)}</span></li>`).join("");
	return `<article class="candidate">
		<h3><span class="letter">${id}</span> ${escapeHtml(title)}</h3>
		<p>${escapeHtml(summary)}</p>
		<p class="audience"><strong>読者</strong> ${escapeHtml(audience)}</p>
		<blockquote>${escapeHtml(opening)}</blockquote>
		<h4>記事の流れ</h4>
		<ol>${outline}</ol>
		<p><strong>図の配置</strong> ${escapeHtml(diagrams)}</p>
		<details>
			<summary>作例・折り畳む内容・構成の懸念</summary>
			<p><strong>作例</strong> ${escapeHtml(example)}</p>
			<p><strong>折り畳む内容</strong> ${escapeHtml(foldedDetails)}</p>
			<p><strong>構成の懸念</strong> ${escapeHtml(tradeoff)}</p>
		</details>
		<section class="review">
			<h4>独立レビュー</h4>
			<dl>
				<dt>冒頭の引き</dt><dd>${escapeHtml(review.opening)}</dd>
				<dt>固有の発見</dt><dd>${escapeHtml(review.discovery)}</dd>
				<dt>具体例の位置</dt><dd>${escapeHtml(review.example)}</dd>
				<dt>試行錯誤の扱い</dt><dd>${escapeHtml(review.process)}</dd>
				<dt>構成の注意点</dt><dd>${escapeHtml(review.caveat)}</dd>
			</dl>
		</section>
	</article>`;
}

function renderPage(data, jsonFile) {
	const title = escapeHtml(data.title);
	const cards = data.candidates.map(renderCandidate).join("\n");
	const recommendation = data.recommendation
		? `<p class="recommendation"><strong>レビューの推奨</strong> ${escapeHtml(data.recommendation)}</p>`
		: "<p>独立レビューでは各案の長所を示しています。</p>";
	const decision = data.decision ? `<p><strong>選択の記録</strong> ${escapeHtml(data.decision)}</p>` : "";
	const recommendedReply = data.recommendation ? "<li><code>推奨</code></li>" : "";
	return `<!doctype html>
<html lang="ja">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${title} | 構成案の比較</title>
	<style>${pageStyle}</style>
</head>
<body>
	<main>
		<header>
			<h1>${title}</h1>
			<p>構成3案と独立レビュー</p>
		</header>
		<section class="approval">
			<h2>構成を選ぶ</h2>
			${recommendation}
			<p>採用する案の文言をチャットに送ってください。条件を変える場合は、変えたい条件も添えてください。</p>
			<ul class="choices">
				${recommendedReply}
				<li><code>A</code></li>
				<li><code>B</code></li>
				<li><code>C</code></li>
				<li><code>条件を変えて再提案</code></li>
			</ul>
			<p>組み合わせる場合は「A を軸に B の具体例を追加」のように送れます。</p>
			${decision}
		</section>
		<section>
			<h2>3案の比較</h2>
			<div class="candidates">${cards}</div>
		</section>
		<p class="data-link"><a href="${jsonFile}">比較・審査データ（JSON）</a></p>
	</main>
</body>
</html>
`;
}
