# PomoBlock 現行アプリ機能整理と課題分析

作成日: 2026-03-22

## 参照ソース

- 実装
  - `src-ui/app-runtime.ts`
  - `src-ui/pages/week/page.ts`
  - `src-ui/pages/week/details-page.ts`
  - `src-ui/pages/now/page.ts`
  - `src-ui/pages/routines/page.ts`
  - `src-ui/pages/routines/events.ts`
  - `src-ui/pages/insights/page.ts`
  - `src-ui/pages/settings/page.ts`
  - `src-tauri/src/application/commands/mod.rs`
- コンセプト
  - `README.md`
  - `doc/v2/core/concept.md`
- 過去の議論・レビュー
  - `doc/v2/log/ux_review_routine_studio_2026-03-01.md`
  - `doc/v2/log/gap_current_vs_v2_issues_2026-02-25.md`

## 1. 現行アプリのコンセプト

### 1.1 目的

PomoBlock は、Google Calendar と連携しながら、時間ブロックの生成・調整・実行・振り返りを一つのデスクトップアプリで回すための Tauri アプリである。  
理想コンセプトでは「時間の制約で行動を前に進める」ことが主題だが、現行実装では次の 5 つが主導線になっている。

- 週次カレンダーでブロックと予定を確認する
- 実行中タイマーを操作する
- Routine Studio でルーチン素材とテンプレートを設計する
- 実績ログを集計して振り返る
- 認証・同期・ブロック設定を管理する

### 1.2 中核オブジェクト

- `Block`
  - 生成済みの時間ブロック。開始/終了時刻、 firmness、source などを持ち、一覧表示・承認・時間調整・削除の対象になる。
- `Task`
  - ブロック内で処理する作業単位。Now 画面で並び替えや完了操作ができ、バックエンドでは作成・更新・分割・繰り越しを扱う。
- `Routine`
  - 現行 UI では単純な一覧編集画面ではなく、Routine Studio の保存済みスケジュールやテンプレート群として表れている。
- `Recipe`
  - タイマー手順の定義。Routine Studio ではテンプレートとして管理され、当日適用や保存の対象になる。
- `Timer / Pomodoro`
  - 実行中のブロックとタスクに対して開始・停止・一時停止・再開・次ステップを制御する実行エンジン。
- `Calendar Sync`
  - Google OAuth、カレンダー同期、同期済みイベント取得を扱う外部連携レイヤ。

### 1.3 Block / Task / Routine / Recipe の階層関係

この 4 つは同じ階層の概念ではない。現行実装と v2 コンセプトを踏まえると、次のように分けると整理しやすい。

#### 基本構造

`Routine -> Block -> Timer Execution` が時間軸の主系列で、`Recipe` は Block の実行手順、`Task` は Block の中で処理する作業項目である。

```text
Routine
  -> いつ繰り返し発生するかを定義する
  -> 将来の特定日に Block を生む

Block
  -> その日のその時間帯を確保する
  -> 実行時には Recipe を参照する
  -> 必要に応じて Task を内包・参照する

Recipe
  -> Block の中でどう進めるかを定義する
  -> Timer が実行するステップ列を持つ

Task
  -> Block の中で何を片付けるかを表す
  -> Recipe とは独立に追加・完了・繰り越しされる
```

#### 4 つの役割の違い

- `Routine`
  - 反復ルール。毎週月曜 9:00 のような再発条件を持つ。
  - 「将来どういう枠を発生させるか」を定義する。
  - 直接実行するものではない。
- `Block`
  - 具体的な日付と開始終了時刻を持つ実体。
  - 「今日 9:00-10:00 は何の時間か」を表す。
  - ユーザーが日次で確認・移動・調整する対象は基本的にこれ。
- `Recipe`
  - Block の中でタイマーをどう進めるかを定義する手順書。
  - 1 つの Recipe を複数の Block や Routine が共有できる。
  - 「25分集中+5分休憩」や「朝支度の 3 ステップ」のような実行パターンを表す。
- `Task`
  - 実際に片付ける仕事。Block や Recipe とは別軸の作業単位。
  - 例: 「A さんに返信」「設計レビューを書く」。
  - 1 つの Block に複数紐づくことがあり、別の Block に持ち越すこともできる。

#### 使い分けの原則

- 予定を繰り返し発生させたいなら `Routine`
- 今日の時間枠として扱いたいなら `Block`
- その時間枠の進め方を固定したいなら `Recipe`
- その時間枠の中で実際に片付ける仕事を管理したいなら `Task`

#### 混同しやすい点

- `Block` と `Task`
  - `Block` は時間枠、`Task` は作業項目。Block は「器」、Task は「中身」。
- `Routine` と `Recipe`
  - `Routine` は発生条件、`Recipe` は実行手順。Routine は「いつ起こすか」、Recipe は「どう進めるか」。
- `Block` と `Recipe`
  - `Block` は予定としての実体、`Recipe` はその中身の進行ロジック。Block がなければ当日の時間枠にならず、Recipe がなければ実行手順が曖昧になる。

#### 現行実装に当てはめた見方

- 現在のデータモデルでは `Block` が中心で、`recipe_id`, `auto_drive_mode`, `contents.task_refs` を持てる。
- `Recipe` は `steps[]` を持ち、Timer 実行時の直接の参照先になる。
- `Routine` は現状 UI では独立エディタよりも、Routine Studio の保存済みスケジュール群として扱われている。
- `Task` は日次実行レイヤに寄っており、Now 画面で順序変更・完了・繰り越しの文脈で使われている。

#### 設計上の整理案

今後の説明やドキュメントでは、4 つを横並びで説明するより、次の 3 層で説明したほうが分かりやすい。

- 計画層
  - `Routine`: 繰り返しの発生ルール
  - `Block`: その日に確保された時間枠
- 実行層
  - `Recipe`: Block をどう進めるかという手順
- 作業層
  - `Task`: Block の中で何を片付けるかという作業項目

### 1.4 現行 UX の主導線

- `Week` / `Week Details`
  - 週の俯瞰と日別の管理操作を担当する。v2 コンセプト上の `Today` が独立画面として未成立のため、現行では `Week` 系画面が確認と調整の責務を肩代わりしている。
- `Now`
  - 現在実行中のタイマー操作と、当日のスケジュール・タスク確認を担当する。
- `Routines`
  - Routine Studio を中心に、モジュール資産、テンプレート、スケジュールを設計する。
- `Insights`
  - 実績ログの集計表示を担当する。
- `Settings`
  - ブロック構成、Git 同期設定、Google 認証を分けて扱う。

## 2. 現行の公開画面と機能

現行の公開ルートは `week`, `week-details`, `now`, `routines`, `insights`, `settings` の 6 つである。  
設定サブページは `blocks`, `git`, `auth` に分かれている。  
主要コマンド群は `blocks`, `pomodoro/timer`, `tasks`, `routines/catalog`, `reflection`, `calendar/auth` で構成される。

### 2.1 Week（週次プランナー画面）

- 役割
  - 週単位でブロックと外部予定を俯瞰し、対象日を選択するメイン画面。
- 主な UI 要素
  - 週次プランナー
  - 現在のタイマー状態カード
  - 未完了タスクのサイドバー
  - 今日へ戻るボタン
- 実行できる主要操作
  - 日付選択
  - 今日へジャンプ
  - 週境界でのバッファ読み込み
  - 右サイドバーからタイマー操作
  - 日付詳細画面への遷移
- 関連するバックエンド/データ
  - `list_blocks`
  - `list_synced_events`
  - `get_pomodoro_state`
  - `list_tasks`

### 2.2 Week Details（日別詳細管理画面）

- 役割
  - 選択日の詳細確認と、同期・再生成・リセットなどの運用操作をまとめて行う画面。
- 主な UI 要素
  - 日付/アカウント入力
  - 同期、本日再生成、ブロックリセット、再読込ボタン
  - 日別カレンダー
  - ブロック一覧テーブル
- 実行できる主要操作
  - 日付変更
  - アカウント変更
  - Google 認証付き同期
  - 当日ブロック再生成
  - ブロック全削除後の再読込
- 関連するバックエンド/データ
  - `authenticate_google_sso`
  - `sync_calendar`
  - `generate_today_blocks`
  - `generate_blocks`
  - `list_blocks`

### 2.3 Now（実行中タイマー画面）

- 役割
  - 実行中のブロックとタスクに対するリアルタイム操作画面。
- 主な UI 要素
  - 当日スケジュール
  - 大型タイマーリング
  - 主要 3 ボタンのタイマー操作
  - Current Objective カード
  - Open Tasks 一覧
  - Notes パネル
  - Buffer / Deferred / Focus Completion の下部サマリー
- 実行できる主要操作
  - タイマー開始
  - 一時停止 / 再開
  - 次ステップへ進む
  - 停止
  - タスク完了
  - タスク並び順の上下入れ替え
  - 日別カレンダーとの連動確認
- 関連するバックエンド/データ
  - `start_block_timer`
  - `pause_timer`
  - `resume_timer`
  - `next_step`
  - `get_pomodoro_state`
  - `list_tasks`
  - `update_task`
  - `get_reflection_summary`

### 2.4 Routines（Routine Studio / ルーチン設計画面）

- 役割
  - ルーチン設計を単一のスタジオ画面で扱う。単純なルーチン一覧ではなく、資産管理・組み立て・スケジュール設計を含む複合画面になっている。
- 主な UI 要素
  - 左ペインのライブラリ
  - 中央キャンバス
  - 右ペインの詳細/保存操作
  - スケジュール用 3 ペインレイアウト
  - 保存済みテンプレート/スケジュール一覧
- 機能面の内訳
  - モジュール資産管理
    - モジュール一覧表示
    - フォルダー作成/削除
    - モジュール作成/編集/削除
    - モジュールのフォルダー移動
  - キャンバス編集
    - モジュールやテンプレートをキャンバスへ追加
    - 順序変更
    - エントリ編集
    - テンプレート保存
    - 当日へのテンプレート適用
  - スケジュール編集
    - 予定エントリの時間配置
    - day offset を含む時刻調整
    - 繰り返し条件の設定
    - 保存時の可視ブロック再生成
  - 保存済みテンプレート/スケジュール管理
    - 保存済み項目の読み込み
    - 削除
    - 移動
    - 現在編集中データへの反映
- 実行できる主要操作
  - アセットの DnD
  - スケジュール項目の時間移動
  - テンプレート保存
  - 当日適用
  - スケジュール保存
  - 保存済みスケジュール削除
- 関連するバックエンド/データ
  - `list_recipes`, `create_recipe`, `update_recipe`, `delete_recipe`
  - `list_modules`, `create_module`, `update_module`, `delete_module`
  - `list_module_folders`, `create_module_folder`, `delete_module_folder`, `move_module`
  - `list_routine_schedules`, `save_routine_schedule_group`, `delete_routine_schedule`
  - `apply_studio_template_to_today`

### 2.5 Insights（振り返り画面）

- 役割
  - 実行ログを期間で集計し、完了率や集中時間を確認する画面。
- 主な UI 要素
  - 期間指定フォーム
  - 完了数、中断数、完了率のメトリクス
  - 集中時間バー
  - ログ一覧
- 実行できる主要操作
  - 開始日/終了日指定
  - 集計の再取得
- 関連するバックエンド/データ
  - `get_reflection_summary`

### 2.6 Settings（設定・認証画面）

- 役割
  - セッション内設定、同期設定、Google 認証を切り替えて管理する画面。
- 主な UI 要素
  - サブページナビゲーション
  - `blocks`: 勤務時間、ブロック長、休憩分数、Routine JSON / Template JSON 入力
  - `git`: Git remote 確認
  - `auth`: Account ID、Authorization Code、SSO ログイン、セッション確認
- 実行できる主要操作
  - ブロック構成のセッション保存
  - Git remote の確認
  - SSO ログインと同期
  - 認証コード交換
  - 認証状態確認
- 関連するバックエンド/データ
  - `authenticate_google_sso`
  - `authenticate_google`
  - `sync_calendar`
  - セッション内 UI state

## 3. 機能横断の問題点

以下は現行実装基準で整理した問題点である。理想コンセプトとの差分は補足として扱い、ここでは現在のコードと画面構成から見える問題を優先する。

### 3.1 UI 観点

#### 1. 画面ごとの情報密度にばらつきがあり、主要操作の優先順位が見えづらい

- 対象
  - `Week`, `Now`, `Routines`
  - `src-ui/pages/week/page.ts`
  - `src-ui/pages/now/page.ts`
  - `src-ui/pages/routines/events.ts`
- 現象
  - `Now` は 3 ペイン構成に下部サマリーまで持ち、`Routines` はさらに大きい 3 ペインまたは 3 分割スケジュールを持つ。一方で `Week` は週次カレンダー中心で、画面ごとの情報量と視線誘導が揃っていない。
- なぜ問題か
  - 各画面で「最初にどこを見ればよいか」が統一されず、操作学習コストが上がる。
- 影響範囲
  - 主要画面全体。特に Routine Studio の初見利用者。

#### 2. Routines 画面は中間幅でレイアウト破綻しやすい

- 対象
  - `Routines`
  - `doc/v2/log/ux_review_routine_studio_2026-03-01.md`
  - `src-ui/pages/routines/events.ts`
- 現象
  - Routine Studio は複数ペイン前提で、モジュール編集、ライブラリ、キャンバス、右側情報パネルが同時に存在する。既存レビューでも中間ブレークポイントでの破綻、編集フォームの押し込み、フッターボタンの見えづらさが指摘されている。
- なぜ問題か
  - 主要操作である保存や編集が視界から外れやすく、作業の継続性を損ねる。
- 影響範囲
  - Routine Studio 利用時全般。

#### 3. UI 言語が英日混在しており、一貫性が低い

- 対象
  - `Week`, `Now`, `Routines`, `Settings`, `Insights`
  - `src-ui/pages/**`
- 現象
  - 画面タイトルや補助文に日本語と英語が混在している。例えば `Week Planner`, `Current Status`, `Next Steps`, `Google Auth`, `集計` が同じプロダクト内で並ぶ。
- なぜ問題か
  - 情報設計の一貫性が崩れ、プロダクトの完成度が低く見える。
- 影響範囲
  - 全体 UI。

#### 4. アイコンやボタン文言が操作意味を十分に伝えていない箇所がある

- 対象
  - `Now`, `Week`
  - `src-ui/app-runtime.ts`
  - `src-ui/pages/now/page.ts`
  - `src-ui/pages/week/renderers.ts`
- 現象
  - タイマー操作モデルでは `leftIcon`, `primaryIcon`, `rightIcon` が `?` のまま定義されている。ラベルはあるが、視覚的に操作意味を補強できていない。
- なぜ問題か
  - 高頻度操作の認知負荷が下がらず、視認性も低い。
- 影響範囲
  - タイマー操作全般。

### 3.2 UX 観点

#### 1. v2 コンセプトの `Today` 体験が独立画面として成立していない

- 対象
  - 画面構成全体
  - `doc/v2/core/concept.md`
  - `src-ui/app-runtime.ts`
- 現象
  - 理想構成は `Today / Now / Routines / Insights` の 4 画面だが、現行公開ルートは `week / week-details / now / routines / insights / settings` である。今日の確認と微調整は `Week` と `Week Details` に分散している。
- なぜ問題か
  - 日次運用の入口が曖昧になり、毎日使う導線としての明快さが落ちる。
- 影響範囲
  - アプリ全体の IA。

#### 2. 運用操作が複数画面に分散しており、利用者が「どこで何をするか」を覚える必要がある

- 対象
  - `Week Details`, `Settings`, `Routines`, `Now`
  - `src-ui/pages/week/details-page.ts`
  - `src-ui/pages/settings/page.ts`
  - `src-ui/pages/routines/events.ts`
- 現象
  - 同期は `Week Details` と `Settings/auth` の双方に存在し、ブロック生成は `Week Details` と `blocks` 管理系に存在する。テンプレート適用は `Routines` にあり、タスク運用は `Now` と未公開の `tasks-page.ts` に分かれる。
- なぜ問題か
  - メンタルモデルが複雑になり、導線が画面責務でなく「実装上そこにある」状態になっている。
- 影響範囲
  - 毎日の運用全体。

#### 3. Routine Studio は高機能だが、初期学習コストが高い

- 対象
  - `Routines`
  - `src-ui/pages/routines/events.ts`
  - `doc/v2/log/ux_review_routine_studio_2026-03-01.md`
- 現象
  - モジュール、フォルダー、テンプレート、キャンバス、スケジュール、保存済みスケジュールなど複数概念が同一画面に同居している。
- なぜ問題か
  - 1 回の編集で理解すべき概念が多く、導入フェーズで迷いやすい。
- 影響範囲
  - ルーチン設計機能全体。

#### 4. 設定画面の `blocks` サブページは暫定 UI の色が強く、実運用導線として弱い

- 対象
  - `Settings`
  - `src-ui/pages/settings/page.ts`
- 現象
  - `Routine JSON` と `Template JSON` がテキストエリアのまま露出しており、構造化された設定編集 UI になっていない。
- なぜ問題か
  - 操作対象が抽象的で、どの設定が何に効くかが分かりにくい。
- 影響範囲
  - 設定変更、初期セットアップ。

#### 5. フィードバックはあるが、操作後の結果が画面意味と結びついていない箇所がある

- 対象
  - `Week Details`, `Blocks`, `Settings`, `Routines`
  - `src-ui/app-runtime.ts`
  - `src-ui/pages/**`
- 現象
  - 多くの操作は `setStatus` による短い文言更新で結果を返すが、画面内の説明や履歴、次アクションの誘導にはつながっていない。
- なぜ問題か
  - 長時間操作時に「今どこまで完了したか」「次に何をすべきか」が残りにくい。
- 影響範囲
  - 同期、保存、削除、適用などの非自明な操作。

### 3.3 コード観点

#### 1. `app-runtime.ts` に責務が集中しすぎている

- 対象
  - `src-ui/app-runtime.ts`
- 現象
  - ルート定義、初期化、定期ポーリング、UI state、モックデータ、共通ヘルパ、レンダラー依存注入、タイマー操作モデルまでが一つのファイルに集約されている。
- なぜ問題か
  - 変更影響の見通しが悪く、画面追加や状態変更時に副作用を追いにくい。
- 影響範囲
  - UI 層全体。

#### 2. 描画と状態更新とイベントバインドが密結合している

- 対象
  - `src-ui/pages/now/page.ts`
  - `src-ui/pages/week/details-page.ts`
  - `src-ui/pages/blocks/page.ts`
  - `src-ui/pages/routines/events.ts`
- 現象
  - `innerHTML` で画面全体を再描画し、その直後に多数のイベントハンドラを毎回張り直す構造が多い。
- なぜ問題か
  - 局所変更がしにくく、DOM 構造変更に弱い。イベント漏れや再描画時の挙動不整合も起きやすい。
- 影響範囲
  - 主要画面全般。

#### 3. Routines 画面が単一ファイル群に多機能を抱え込み、保守境界が曖昧

- 対象
  - `src-ui/pages/routines/events.ts`
  - `src-ui/pages/routines/studio/**`
- 現象
  - Routine Studio では初期化、アセット読込、スケジュールモデル構築、ドラッグ移動、保存、削除、再生成までを一連の巨大な制御フローで扱っている。
- なぜ問題か
  - 一機能だけ直したくても周辺状態を強く意識する必要があり、回帰リスクが高い。
- 影響範囲
  - ルーチン設計機能全体。

#### 4. 公開画面と内部機能の境界がやや曖昧

- 対象
  - `src-ui/app-runtime.ts`
  - `src-ui/pages/blocks/page.ts`
  - `src-ui/pages/tasks-page.ts`
- 現象
  - `blocks/page.ts` や `tasks-page.ts` のような管理系画面が存在する一方、現行公開ルートには `blocks` や `tasks` が含まれていない。公開導線と保守用 UI の区別がコード上で明確に整理されていない。
- なぜ問題か
  - どの画面がプロダクト仕様で、どの画面が補助ツールなのかが読み取りづらい。
- 影響範囲
  - 画面設計、保守、ドキュメント整備。

#### 5. コマンド層の機能範囲は整理されているが、UI 側から見ると概念の分離が十分に表れていない

- 対象
  - `src-tauri/src/application/commands/mod.rs`
  - `src-ui/pages/**`
- 現象
  - バックエンドでは `blocks`, `calendar`, `catalog`, `routines`, `pomodoro`, `reflection`, `tasks` に整理されているが、UI 側は画面ごとに複数コマンド群を直接混在して呼び出している。
- なぜ問題か
  - UI の責務分離がバックエンドの境界と揃わず、画面ロジックが肥大化しやすい。
- 影響範囲
  - 画面実装全体。

## 4. 補足

- 本文書は現行実装基準で整理しているため、「理想仕様に未到達だから問題」とは書いていない。
- ただし構造上もっとも大きい差分は、`Today` 中心の 4 画面体験がまだ実装に落ちきっておらず、`Week` 系画面がその責務を肩代わりしている点である。
- Routine Studio については、既存レビュー文書の指摘と整合するよう、UI 問題と UX 問題を分けて記載した。
