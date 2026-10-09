// 検出済みファイルから宣言された事実だけを作る。本文の意味やコマンドの安全性は推測しない。
import { matchesGlob } from "node:path";
import { z } from "zod";
import type { WorkspaceDetection } from "@nerita/dlc/workspace";

export const manifestSchema = z.object({
	name: z.string().optional(),
	packageManager: z.string().optional(),
	scripts: z.record(z.string(), z.string()).optional(),
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
});
export const languageNames: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	py: "python",
	rs: "rust",
	go: "go",
	cs: "csharp",
	java: "java",
	kt: "kotlin",
	rb: "ruby",
	cpp: "cpp",
	c: "c",
	swift: "swift",
};
export const configLanguages: Record<string, string> = {
	"tsconfig.json": "typescript",
	"pyproject.toml": "python",
	"Cargo.toml": "rust",
	"go.mod": "go",
	"pom.xml": "java",
	"build.gradle": "java",
	Gemfile: "ruby",
};
export const packageManagers = z.enum([
	"pnpm",
	"npm",
	"yarn",
	"bun",
	"unknown",
]);
export const lockManagers = {
	"pnpm-lock.yaml": "pnpm",
	"package-lock.json": "npm",
	"yarn.lock": "yarn",
	"bun.lock": "bun",
} as const;

export function declaredFrameworks(
	path: string,
	projectRoot: string,
	manifest: z.infer<typeof manifestSchema>,
): WorkspaceDetection["frameworks"] {
	const dependencies = {
		...manifest.dependencies,
		...manifest.devDependencies,
	};
	const frameworks = {
		react: "react",
		vue: "vue",
		next: "next",
		svelte: "svelte",
		express: "express",
		angular: "@angular/core",
	};
	return Object.entries(frameworks)
		.filter(([, dependency]) => dependency in dependencies)
		.map(([name, dependency]) => ({
			name,
			projectRoot,
			evidence: [
				`${path}#/${manifest.dependencies?.[dependency] === undefined ? "devDependencies" : "dependencies"}/${dependency}`,
			],
		}));
}
export function classification(
	names: string[],
	evidence: string[],
): WorkspaceDetection["classification"]["detected"] {
	if (evidence.length > 0) {
		return "brownfield";
	}
	return names.length === 0 ||
		names.every((name) =>
			/(?:^|\/)(?:README[^/]*|LICENSE[^/]*|\.gitignore|AGENTS\.md)$/iu.test(
				name,
			),
		)
		? "greenfield"
		: "unknown";
}
export function packageRoot(path: string): string {
	const root = path.split("/").slice(0, -1).join("/");
	return root === "" ? "." : root;
}
/** 否定パターンは包含パターンより優先する。 */
export function selectedPackage(root: string, patterns: string[]): boolean {
	return (
		patterns.some(
			(pattern) => !pattern.startsWith("!") && matchesGlob(root, pattern),
		) &&
		!patterns.some(
			(pattern) =>
				pattern.startsWith("!") && matchesGlob(root, pattern.slice(1)),
		)
	);
}
