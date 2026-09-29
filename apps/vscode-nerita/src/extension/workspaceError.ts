// ワークスペースの検証エラーを、パス操作に依存せず識別する。
/** 秘密情報を含まず、そのまま UI に表示できる起動条件のエラー。 */
export class WorkspaceError extends Error {}
