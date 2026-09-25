// Host 専用モジュールを Node 上で読み込むための境界。API を使うテストは個別に実装を差し替える。
import { vi } from "vitest";

// 空の境界により、モック未定義の VS Code 操作は成功扱いにせず失敗させる。
vi.mock("vscode", () => ({ workspace: {}, window: {} }));
