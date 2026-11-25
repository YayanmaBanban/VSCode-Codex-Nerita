> **未解決のため実行できません。** この資料は未解決のTypeScript Skillから参照されます。利用前にユーザーへ未解決事項を伝えて停止してください。以下のコード例と規則は原文の日本語訳です。

# TypeScriptの実装パターン

`SKILL.md`の各規則に対応するコード例。基礎となるPrincipleは言語に依存しない。**type-system-discipline**と**boundary-discipline**を参照する。

## ブランド付き型

プリミティブ型をブランドで区別し、取り違えを防ぐ。境界で一度検証する。下流のコードは型を信用する。

```ts
type AgentId = string & { readonly __brand: "AgentId" };

function isAgentId(input: string): input is AgentId {
  return isUUID(input);
}

function parseAgentId(input: string): AgentId {
  if (!isAgentId(input)) throw new Error(`Invalid agent id: ${input}`);
  return input;
}

function focusAgent(id: AgentId): void {
  /* 入力は検証済み */
}
```

`readonly __brand: 'X'`という形を使う。新しい命名規則を作らない。

## 判別可能なUnion

リテラル値を判別子としてバリアントを表す。すべてのバリアントは同じフィールド名を共有し、その値は各バリアントで異なるため、あり得ない組み合わせを表現できない。

```ts
// 悪い例。booleanと省略可能フィールドにより矛盾した状態を作れてしまう。
type DiffState = { loading: boolean; diff?: GitDiff; error?: string };

// 良い例。有効な状態しか存在しない。
type DiffState =
  | { kind: "loading" }
  | { kind: "ready"; diff: GitDiff }
  | { kind: "error"; error: string };
```

判別子の名前（`kind`、`type`、`tag`など）は一つに決め、一貫して使う。

## 構築によるモデル化

緩い型へ実行時チェックを追加する代わりに、すべて合法な部品から型を組み立てる。

可変長タプルで空でない配列を表す。

```ts
type NonEmpty<T> = [T, ...T[]];

// 悪い例。T[]なので各呼び出し側が長さを毎回確認する必要がある。
function pickWinner(entries: string[]): string {
  if (entries.length === 0) throw new Error("no entries");
  return entries[Math.floor(Math.random() * entries.length)];
}

// 良い例。空の値をこの型で構築することはできない。
function pickWinner(entries: NonEmpty<string>): string {
  return entries[Math.floor(Math.random() * entries.length)];
}
```

通常の`T[]`を受け取った場所で一度だけガードによって絞り込む。その事実は型とともに伝わる。

```ts
const isNonEmpty = <T>(arr: T[]): arr is NonEmpty<T> => arr.length > 0;
```

偶数長はペアで表す。

```ts
type Pairs<T> = [T, T][];
```

時間の範囲は開始と期間で表す。

```ts
// 悪い例。不変条件をコメントだけで保持している。
type TimeRange = { start: Date; end: Date }; // start <= end

// 良い例。負の範囲を書けない。終了時点は必要なときに導出する。
type TimeRange = { start: Date; durationMs: number };
```

`durationMs`は通常の数値のままとする。反射的にブランドを付けず、生の数値を期間と間違えて渡す可能性がある場合だけブランドを付ける。悪い状態を構築できなくする表現を選び、必要な読み取り方法（`pairs.flat()`や`rangeEnd()`補助関数）を提供する。

## 最も単純な全域型

すべての操作が全域的に定義できるなら、何でも強い型にしないで`T[]`を維持する。

```ts
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0); // 空配列なら0なので問題ない。
```

緩い型のために利用箇所で嘘が必要になる場合は強い型にする。兆候は`!`、`arr[0] as T`、「起こるはずがない」というthrowである。

```ts
// 悪い例。未定義になり得ることをコンパイラーから隠している。
function newestSession(sessions: Session[]): Session {
  return sessions.at(0)!;
}

// 良い例。引数の型を強め、アサーションをなくす。
function newestSession(sessions: NonEmpty<Session>): Session {
  return sessions[0];
}
```

結果を`Session | undefined`へ弱める方法も、全域的なシグネチャである。

## `any`より`unknown`

外部データは常に`unknown`とする。使う前に型を絞る。

```ts
// 悪い例
function handle(input: any) {
  return input.foo.bar;
}

// 良い例
function handle(input: unknown) {
  if (typeof input === "object" && input !== null && "foo" in input) {
    // 型を絞り込んだ。コンパイラーがアクセスを検証する。
  }
}
```

外部の情報源にはRPCペイロード、`JSON.parse`、`postMessage`、IPC、ファイル内容、環境変数、DB結果が含まれる。

## 手書きガードよりスキーマ

外部データにプロパティごとの型ガードを書く前に、リポジトリで使用している実行時スキーマライブラリと既存スキーマを探す。検証の正本は一つのスキーマとし、そこからTypeScriptの型を導く。互いにずれるスキーマ、重複したinterface、型ガードを並行して管理しない。

```ts
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["admin", "member"]),
});

type User = z.infer<typeof UserSchema>;

function parseUser(input: unknown): User {
  return UserSchema.parse(input);
}
```

失敗が想定される分岐なら`safeParse`を使う。ほかのスキーマライブラリを使う場合は相当する型推論の補助機能を使用する。一つのガードのためだけに新しいスキーマ依存を追加しない。コードベースがすでに使うスキーマの仕組みを優先する規則である。

## `as`によるキャストを使わない

すべての`as`は実行時クラッシュにつながる可能性がある。型システムが主張を検証した後だけキャストする。

```ts
import { z } from "zod";

// 悪い例
const user = data as User;

// 悪い例
function isUser(data: unknown): data is User {
  return typeof data === "object" && data !== null && "id" in data;
}

// 良い例
const userSchema = z.object({ id: z.string(), name: z.string() });
type User = z.infer<typeof userSchema>;

function parseUser(data: unknown): User {
  return userSchema.parse(data);
}
```

型を先に定義する場合は、バリデーターに証明対象の型を注釈する。すると型より少ない内容しか検証しないバリデーターをコンパイラーが拒否する。以下のオブジェクトから`name`を削除すると代入でコンパイルエラーになる。

```ts
type User = { id: string; name: string };

const userSchema: z.ZodType<User> = z.object({ id: z.string(), name: z.string() });
```

既存コードから`as`を除くリファクタリングでは、TypeScriptが型を推論できない理由を特定する。

- 判別子がない。判別子を追加し、判別可能なUnionへ変更する。
- 入力元の型が広すぎる（例：`Record<string, unknown>`）。絞り込む。
- 境界に型がない。データ構造の正本となるスキーマで解析する。存在しない場合だけスキーマを追加する。
- 本当に型で表せない。ブランド付き型か`satisfies`を使用する。

## 型の絞り込みの優先順位

推奨から最終手段への順序。

1. **判別可能なUnionのswitch／if。** コンパイラーが自動的に絞り込む。
2. **`in`演算子。** `"key" in obj`はそのキーを持つバリアントに絞る。
3. **`typeof`／`instanceof`。** プリミティブ値やクラスインスタンスに使う。
4. **ユーザー定義の型ガード。** 上記で足りない場合。
5. **`as`キャスト。** 検証後に限る。

```ts
function area(s: Shape): number {
  if ("radius" in s) return Math.PI * s.radius ** 2; // 円に型を絞った。
  return s.width * s.height; // 長方形に型を絞った。
}
```

## 型ガード

ガードは主張する内容を実際に検証しなければならない。嘘をつくガードは`as`より悪い。

```ts
function isCircle(s: Shape): s is Shape & { kind: "circle" } {
  return s.kind === "circle";
}
```

可能なら判別子による絞り込みを優先する。

## 網羅性

default節では判別子を`never`型のローカル変数へ代入する。

```ts
// 値を返すswitch
function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2;
    case "rect":
      return s.width * s.height;
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

// 戻り値なしのswitch
function handle(s: Shape): void {
  switch (s.kind) {
    case "circle":
      drawCircle(s);
      break;
    case "rect":
      drawRect(s);
      break;
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
    }
  }
}
```

値を返すswitchではreturnを使い、文として使うswitchではvoidを使う。

## `as`より`satisfies`

`satisfies`はリテラル型を広げずに値を検証する。

```ts
// 悪い例。型が広がり、リテラル型を失う。
const config = { theme: "dark", cols: 3 } as Config;

// 良い例。検証し、リテラル型も維持する。
const config = { theme: "dark", cols: 3 } satisfies Config;
// config.themeは一般のstringではなく、リテラルの"dark"である。
```

## 境界での検証

外部からデータが入る境界で一度検証し、内部では型を信用する。**boundary-discipline** Principleを参照する。

- **通信形式**（proto、JSON-RPC）：`ignoreUnknownFields`で解析し、将来のフィールド追加が古いクライアントを壊さないようにする。
- **保存済みJSON：** バージョン付きのデータ塊とし、解析時にtry/catchを使う。
- **繰り返し検証しない：** 呼び出しの連鎖の奥で再検証しない。

## スキーマから型を導く

`.proto`、OpenAPI、GraphQLスキーマ、DBマイグレーションがすでにデータ形状を定義しているなら、重複した型を作らず生成された型から導出する。

```ts
// 悪い例。構造が重複し、スキーマ変更に追従できなくなる。
type CheckSummary = {
  totalCount: number;
  checks: { name: string; status: string }[];
};
function renderChecks(s: CheckSummary) {
  /* ... */
}

// 良い例。生成されたスキーマ型から導出する。
import type { ChecksMessage } from "<generated module>";
function renderChecks(s: Pick<ChecksMessage, "totalCount" | "checks">) {
  /* ... */
}
```

新しいinterfaceを書く前に`Pick`、`Omit`、`Parameters`、`ReturnType`、`Awaited`、`typeof`を検討する。

## オブジェクト引数

```ts
// 悪い例。2つの引数を取り違えてもコンパイルできる。
openFile(uri, {
  startLineNumber: 10,
  startColumn: 1,
  endLineNumber: 10,
  endColumn: 1,
});

// 良い例。順序に依存せず、自己説明的である。
openFile({
  uri,
  selection: {
    startLineNumber: 10,
    startColumn: 1,
    endLineNumber: 10,
    endColumn: 1,
  },
});
```

ホットパスでは省く。フレームごとの描画、トークナイザー、パーサー、割り当てコストが問題となる密なループなどが該当する。
