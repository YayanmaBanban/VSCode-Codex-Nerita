// Lexical の編集インスタンスを、入力欄ごとの Svelte ツリーへ限定する。
import { createContext } from "svelte";
import type { LexicalEditor } from "lexical";

export const [getLexicalEditor, setLexicalEditor] =
	createContext<LexicalEditor>();

/** 外部の下書きへ置換した本文を、次の編集の履歴開始点にする。 */
export const [getLexicalHistoryReset, setLexicalHistoryReset] =
	createContext<() => void>();
