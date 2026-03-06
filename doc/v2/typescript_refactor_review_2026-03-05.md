# TypeScript Refactor Review (2026-03-05)

## 概要
- 対象: `src-ui/**/*.ts`, `src/**/*.ts` の構造・責務分割・DRY/KISS観点レビュー
- 目的: 今後の機能追加時に変更コストと回帰リスクを下げる
- 形式: 重要度順の指摘 + 実行しやすい改善ステップ

## 主要な指摘 (優先度順)

### 1. [P1] 時刻依存ロジックが純粋関数になっていない
- 対象: `src-ui/now.ts`
- 該当:
  - `resolveNowAutoStartBlock` は `reference` 引数を受ける設計だが、内部で `Date.now()` を直接使用している
- 問題:
  - 引数駆動でテストできない
  - 再現性が下がる
  - 機能分割済みロジックの責務が曖昧になる
- 改善:
  - `Date.now()` を排除し `reference.getTime()` に統一
  - `now.ts` を副作用ゼロの計算モジュールとして固定

### 2. [P2] `app-runtime.ts` が責務過多 (God file)
- 対象: `src-ui/app-runtime.ts` (約2000行)
- 同居している責務:
  - UI状態保持
  - ルーティング
  - ページ描画制御
  - コマンド実行ラッパ
  - mock backend (`mockInvoke`) の本体実装
- 問題:
  - 1ファイルの変更で影響範囲が広すぎる
  - レビューとテスト観点の切り分けが困難
  - 機能追加時に競合が増える
- 改善:
  - `app-runtime.ts` をオーケストレーション専用に縮小し、以下へ分割
    - `src-ui/runtime/state.ts` (uiState 初期化)
    - `src-ui/runtime/routing.ts` (route解決と画面切替)
    - `src-ui/runtime/progress.ts` (進捗表示)
    - `src-ui/runtime/timer-loop.ts` (setInterval群)
    - `src-ui/mock/mock-invoke.ts` (mock backend)

### 3. [P2] DRY違反: import済み関数の薄いラッパーが大量に存在
- 対象: `src-ui/app-runtime.ts`
- 該当:
  - `xxxValue` として import した関数を、同名ローカル関数で単純再公開している箇所が多い
- 問題:
  - 実体ロジックの所在が分かりにくい
  - 将来修正時に追跡コストが増える
- 改善:
  - 単純中継しかしていない関数は削除し、import元を直接利用
  - `uiState` 注入が必要な関数だけ薄い adapter として残す

### 4. [P3] 同一ロジックの重複定義
- 対象:
  - `src-ui/commands.ts`
  - `src-ui/tauri-contracts.ts`
- 該当:
  - `isUnknownCommandError` が重複定義
- 問題:
  - 片方のみ更新される不整合リスク
- 改善:
  - 共通化して1箇所に集約 (`src-ui/errors/command-errors.ts` など)

### 5. [P3] JSON文字列の部分一致検索に依存
- 対象: `src/infrastructure/localStorageRepository.ts`
- 該当:
  - `task_refs LIKE %${taskId}%`
- 問題:
  - 部分一致で不要行を拾う可能性
  - データ量増加時に不要更新コストが増える
- 改善:
  - 短期: LIKEは候補抽出用途に限定し、厳密判定を明示
  - 中期: `block_task_refs` のような正規化テーブルへ分離

## 配置・機能分割の提案

### UI層 (`src-ui`)
- `src-ui/runtime/`
  - `start-app.ts` (startAppのみ)
  - `render-loop.ts` (render, hashchange, polling)
  - `deps-factory.ts` (`buildPageRenderDeps`)
- `src-ui/mock/`
  - `mock-invoke.ts`
  - `mock-seed.ts`
- `src-ui/services/`
  - 既存 `command-service.ts` を維持
  - `clock-service.ts` (現在時刻取得を抽象化する場合)
- `src-ui/utils/`
  - `command-errors.ts` (`isUnknownCommandError` 集約)

### Node層 (`src`)
- `infrastructure/localStorageRepository.ts` は機能が多いため分離候補:
  - `block-repository.ts`
  - `task-repository.ts`
  - `pomodoro-log-repository.ts`
  - `sync-state-repository.ts`
- まずはSQL/mapperの分割だけでも可 (クラス分割が重ければ段階実施)

## DRY/KISS適用の具体例
- DRY:
  - `isUnknownCommandError` を単一化
  - `app-runtime.ts` の `xxxValue` ラッパーを削減
- KISS:
  - `now.ts` の計算系は「入力 -> 出力」のみ
  - UI更新副作用は runtime 側に限定
- SRP:
  - mock APIの巨大 `switch` をファイル分割し、command別ハンドラ化

## 推奨リファクタリング順序
1. `src-ui/now.ts` の時刻参照を引数化して純粋化 (低コスト・高効果)
2. `isUnknownCommandError` を共通化 (低コスト)
3. `app-runtime.ts` から `mockInvoke` を分離 (中コスト)
4. `app-runtime.ts` から `buildPageRenderDeps` と timer loop を分離 (中コスト)
5. `localStorageRepository.ts` の責務分割 (中〜高コスト)

## テスト観点 (追加推奨)
- `src-ui/now.ts`
  - `resolveNowAutoStartBlock` が `reference` 依存で決定されることの単体テスト
- `src-ui/runtime/*`
  - hash route変更時の描画分岐テスト
- `src/infrastructure/*`
  - `task_refs` 更新時の誤一致がないことのリグレッションテスト

## 備考
- 本レビューは静的レビュー結果。
- 実装変更・テスト実行はこのドキュメント作成では未実施。

関連タスク: doc/v2/typescript_refactor_tasks_2026-03-05.md
