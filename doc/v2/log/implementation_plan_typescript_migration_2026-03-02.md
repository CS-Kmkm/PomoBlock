# PomBlock TypeScript移行 実装プラン（2026-03-02）

## 1. 目的
- `5-refactoring` 配下の JavaScript 実装を TypeScript へ移行し、ビルド/テスト/CLI 実行を `tsc` ベースへ統一する。
- 既存挙動（CLIコマンド・テスト仕様・UIルーティング）を維持しながら、段階的に型安全性を高める。

## 2. スコープ
- 対象:
  - `src/**/*.js` → `src/**/*.ts`
  - `tests/**/*.test.js` → `tests/**/*.test.ts`
  - `src-ui/app.js` → `src-ui/app.ts`
- 対象外:
  - UIの大規模分割・アーキテクチャ刷新
  - バンドラ導入（Vite/Webpack）

## 3. 採用方針（決定事項）
- モジュール形式は ESM 維持（`type: "module"`）。
- Node実行とUIビルドは分離コンパイル:
  - `tsconfig.node.json`
  - `tsconfig.ui.json`
- import specifier は `.js` 拡張子を維持（NodeNext 運用）。
- Node側は `dist/` 実行、UI側は `src-ui/dist/app.js` を `index.html` から参照。
- strict は段階導入（フェーズA→B→C）。

## 4. 実装項目

### 4.1 ツールチェーン・設定
- 依存追加:
  - `typescript`
  - `@types/node`
- 設定追加:
  - `tsconfig.base.json`
  - `tsconfig.node.json`
  - `tsconfig.ui.json`
- `package.json` scripts を TypeScript 前提に更新:
  - `build`, `build:node`, `build:ui`
  - `test`, `init`, `status`, `typecheck`
  - `copy:schema`（`schema.sql` を `dist` へコピー）

### 4.2 ソース移行
- `src`, `tests`, `src-ui/app` を `.ts` 化。
- `src-ui/index.html` の script 参照を `./dist/app.js` へ変更。
- `src-ui/global.d.ts` を追加し、`window.__TAURI__` / `window.__TAURI_INTERNALS__` の最小 invoke 型を定義。

### 4.3 型の明示化（初期）
- `src/domain/models.ts` に公開型を追加:
  - `Block`, `Task`, `Policy`, `PomodoroLog`, `PomodoroState` など
- `src-ui/app.ts` に主要状態型の土台を追加:
  - `UiState`
  - `Block`, `Task`, `SyncedEvent`, `PomodoroState`

## 5. 段階的strict化ロードマップ

### フェーズA（完了）
- 目的: まず移行を成立させ、ビルドと回帰テストを安定化。
- 状態:
  - `build`, `test`, `typecheck` は成功。
  - 既存挙動維持を優先し、型未整備箇所は一時的に `// @ts-nocheck` で許容。

### フェーズB（次対応）
- 設定強化:
  - `noImplicitAny: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
- 優先改善:
  - `src-ui/app.ts` の `any/unknown` 削減
  - invoke 入出力型の厳密化
  - DOMイベント型の明示

### フェーズC（最終）
- `strict: true` を有効化。
- `@ts-nocheck` を撤廃。
- 残存 `any` を `unknown + narrowing` または明示型へ置換。

## 6. 受け入れ基準
- `npm run build` が成功し、`dist/` と `src-ui/dist/` が生成される。
- `npm test` が全件パスする。
- `npm run typecheck` が成功する。
- `npm run init -- <path>` / `npm run status -- <path>` が従来どおり動作する。
- `src-ui/index.html` で `dist/app.js` が読み込まれ、主要画面描画が成立する。

## 7. リスクと対策
- リスク: UI単一巨大ファイルにより strict 化コストが高い。
  - 対策: フェーズBで機能単位に型付け優先順位を固定（state → invoke → DOMイベント）。
- リスク: 非TS資産（SQL等）が `dist` に存在せず実行エラー。
  - 対策: `copy:schema` を `build:node` に組み込み済み。

## 8. 運用メモ
- ビルド成果物はGit管理対象外:
  - `dist/`
  - `src-ui/dist/`
- 以降の開発フロー:
  1. `npm run build`
  2. `npm test`
  3. `npm run typecheck`
