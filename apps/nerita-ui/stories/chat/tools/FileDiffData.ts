// 個人の環境に依存しない表示データと、Host 通知を注入する操作。
export const path = "apps/nerita-ui/src/ui/BorderBeam.tsx";
export const oldLines = Array.from(
	{ length: 100 },
	(_, index) => `// 行 ${index + 1}`,
);
export const newLines = [...oldLines];
