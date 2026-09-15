// Webview の Tailwind CSS を生成し、クラスの追加・変更も watch に反映する。
const fs = require("node:fs/promises");
const path = require("node:path");
const postcss = require("postcss");
const tailwindcss = require("@tailwindcss/postcss");

/** ソースの追加と既存ファイルの変更を監視するために列挙する。 */
async function collectSources(directory, files, directories) {
	directories.push(directory);
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await collectSources(target, files, directories);
		} else if (entry.isFile()) {
			files.push(target);
		}
	}
}

/** Tailwind の入口だけを処理し、既存 CSS は esbuild に任せる。 */
function tailwindPlugin() {
	return {
		name: "tailwind-css",
		setup(build) {
			build.onLoad({ filter: /[\\/]tailwind\.css$/ }, async (args) => {
				const result = await postcss([tailwindcss()]).process(
					await fs.readFile(args.path, "utf8"),
					{ from: args.path, map: false },
				);
				const watchFiles = [args.path];
				const watchDirs = [];
				await collectSources(
					path.resolve("src/webview"),
					watchFiles,
					watchDirs,
				);
				for (const message of result.messages) {
					if (message.type === "dependency" && message.file) {
						watchFiles.push(message.file);
					}
				}
				return {
					contents: result.css,
					loader: "css",
					watchFiles,
					watchDirs,
				};
			});
		},
	};
}

module.exports = { tailwindPlugin };
