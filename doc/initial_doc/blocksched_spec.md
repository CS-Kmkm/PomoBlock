# BlockSched 仕様ドキュメント（v1.2）

本書は、Windows単体アプリとして **Gitで設定同期**しつつ、**Google Calendar を唯一の真実**としてブロック/予定を管理するための実装仕様をまとめる。

---

## 1. システム構成
### 1.1 コンポーネント
- **Windows デスクトップアプリ**
  - UI：TypeScript（任意：Tauri/Electron 等）
  - ローカル機能：Google OAuth、Calendar同期、空き枠計算、ブロック生成、ポモドーロ、Git同期
- **データソース**
  - Google Calendar：予定・ブロック（Blocks専用カレンダー）
  - Git：設定（テンプレ/ルーティーン/ポリシー/上書き）
  - ローカル：トークン/キャッシュ/差分同期状態/抑止リスト/実績ログ

### 1.2 カレンダー構成
- `Blocks` 専用カレンダー：ブロックは必ずここに作る（イベント数を小さく保つ）
- busy参照カレンダー：ユーザー選択（空き枠検索・衝突判定用）
- （任意）`Routines` 可視化カレンダー：必要な場合のみ

---

## 2. ドメインモデル（v1）
### 2.1 Block（作業枠）
- `id`：ULID/UUID（不変）
- `instance`：インスタンスキー（重複防止の主キー）
- `date`：YYYY-MM-DD（ユーザーTZ基準の所属日）
- `startAt` / `endAt`：RFC3339（TZ込み）
- `type`：deep/shallow/admin/learning
- `firmness`：draft/soft/hard
- `plannedPomodoros`：int
- `status`：planned/running/done/partial/skipped（主にアプリ内状態）
- `source`：template/routine/manual
- `sourceId`：テンプレID or ルーティーンID（任意）
- `taskRefs`：短い参照のみ（任意）

### 2.2 Routine（繰り返し定義）
- `id`：rtn_*
- `rrule`：RFC5545互換文字列
- `default`：start/duration/type/pomodoros/firmness
- `exceptions`：skip期間等
- `carryover`：繰越方針（任意）

### 2.3 Pomodoro（実行ログ）
- `focus/break/long_break` のセッションログ
- 高頻度ログはローカル保存（カレンダーへは集計のみ反映が基本）

---

## 3. Google Calendar イベント仕様（Blocksカレンダー）
### 3.1 イベント識別
- **extendedProperties.private** に `bs_*` を付与し、アプリイベントを識別する  
  - 主要キー：
    - `bs_v` = "1"
    - `bs_app` = "blocksched"
    - `bs_kind` = "block"
    - `bs_id` = ULID/UUID
    - `bs_instance` = インスタンスキー（下記）
    - `bs_date` = "YYYY-MM-DD"
    - `bs_src` = template|routine|manual
    - `bs_src_id` = tpl_*|rtn_*（任意）
    - `bs_type` = deep|shallow|admin|learning
    - `bs_firm` = draft|soft|hard
    - `bs_pp` = planned pomodoros（文字列）

### 3.2 インスタンスキー（冪等生成の鍵）
- テンプレ由来：`tpl:<templateBlockId>:<YYYY-MM-DD>`
- ルーティーン由来：`rtn:<routineId>:<YYYY-MM-DD>`
- 手動ブロック：`man:<bs_id>`

### 3.3 表示（summary / description / color）
- `summary`：短くタグ付け（例：`[DW] 設計`）
- `description`：人間用メモ + 復旧用の短いヘッダ（任意）
- `colorId`：type→colorId は設定ファイルで指定

### 3.4 外部編集の許容
- ユーザーがカレンダーUIで `start/end/summary/description/color` を変更してもOK
- アプリはこれらを原則上書きしない（カレンダーが正）
- 識別は `bs_instance` が残っている限り維持される

---

## 4. 生成（毎朝＋手動）
### 4.1 生成タイミング
- **毎朝自動生成**：Windows タスクスケジューラで CLI 起動（例：05:30）
- **キャッチアップ**：PCオフ等で実行できなかった場合、次回起動時に「当日未生成なら実行」
- **手動生成**：UI/CLI から日付指定で実行（差分プレビュー推奨）

### 4.2 生成の共通手順（順序が重要）
1. Blocksカレンダーの差分同期（syncToken）
2. 生成対象日の期待インスタンス集合（テンプレ＋ルーティーン）を作成
3. 既存イベントの `bs_instance` と照合
   - 既に存在：作らない（外部編集を尊重）
   - suppression あり：自動生成では作らない
4. 残りのみ作成（配置戦略に従う）

### 4.3 配置戦略
- `keep`：テンプレ通りの時刻に作る（衝突しても作る）
- `shift`：衝突したら同日内の空き枠へ移動（探索上限あり）
- `createIfNoSlot`：空き枠がない場合に作る/作らない

---

## 5. suppression（削除復活防止）
### 5.1 目的
ユーザーがカレンダーで削除したブロックを、毎朝自動生成で勝手に復活させない。

### 5.2 仕様
- 差分同期で `status=cancelled` を受信し、`bs_instance` があれば `state/suppressions.json` に記録
- 自動生成は suppression を尊重し、その `bs_instance` を生成しない
- 手動生成では suppression を解除して作成できる

---

## 6. 差分同期（syncToken）仕様
### 6.1 状態ファイル
- `state/sync_state.json`（Git管理しない）
  - `syncToken`、`lastSyncAt`、同期クエリ固定情報を保持

### 6.2 初回フル同期
- `events.list` をページング完走し、最後のレスポンスに含まれる `nextSyncToken` を保存
- `showDeleted=true`（削除イベントも取り込む）

### 6.3 差分同期
- `events.list(syncToken=...)` をページング
- 変更イベント（更新・削除）をローカルストアへ反映
- **禁止パラメータ**（timeMin/timeMax/orderBy/q 等）を付けない

### 6.4 syncToken失効（HTTP 410）
- ローカルストアをクリアし、フル同期をやり直す

> 注意：syncToken 同期はサーバ側フィルタが効きにくい。したがって差分同期対象は **Blocksカレンダーのみ**をデフォルト推奨。予定表示は期間取得、空き枠は Freebusy を利用する。

---

## 7. 空き枠検索仕様（概要）
- busyソース：
  - Freebusy（選択カレンダーの busy 区間）
  - Blocksカレンダー内のブロック（hard/softは設定により扱い分け可能）
- 制約：
  - 勤務窓（work windows）
  - 前後バッファ
  - 最小連続時間
- 出力：
  - 候補スロット（start/end/score/tags）
- ブロック生成（shift）時の探索にも同じロジックを使う

---

## 8. Git同期仕様（設定ファイル）
### 8.1 リポジトリ構成（推奨）
- `config/`：Git管理（人間が編集）
- `state/`：Git管理しない（トークン/キャッシュ/同期状態/抑止）
- `logs/`：任意（Git管理するなら日次集計のみ推奨）

### 8.2 設定ファイル一覧（schema=1）
- `config/app.yaml`
- `config/calendars.yaml`
- `config/pomodoro.yaml`
- `config/policies.yaml`（generation含む）
- `config/templates.yaml`（テンプレブロックに id 必須）
- `config/routines/*.yaml`
- `config/overrides.yaml`（ユーザー上書きのみ。推定値は state 側）

---

## 9. 主要設定スキーマ（抜粋）
### 9.1 generation（policies.yaml）
- `autoEnabled`：毎朝自動生成ON/OFF
- `autoTime`：実行目標時刻
- `catchUpOnAppStart`：起動時補完
- `placementStrategy`：keep|shift
- `maxShiftMinutes`：shift探索上限
- `createIfNoSlot`：空き無し時の作成可否
- `respectSuppression`：抑止尊重

### 9.2 overrides（overrides.yaml）
- `mode`：none|soft|hard|temporary
- `value`：上書き値
- `weight`：softブレンド比（任意）
- `validFrom/validTo`：temporary期間

---

## 10. 非機能要件（v1）
- タイムゾーン：ユーザーTZを単一の真実として保持（内部はUTCでも可）
- 機密：OAuthトークンはローカル安全領域へ保存し、Gitへは絶対に入れない
- 耐障害：同期失敗時はローカル状態を壊さず再試行可能にする
- 監査：生成/削除検知/抑止/手動復活等はローカルログに残す（任意）

---

## 付録：ファイル例（最小）
- templates.yaml の各 block に `id` を必須
- routines は 1ファイル=1ルーティーンで競合を低減
- suppression/sync_state は state 配下でローカルのみ
