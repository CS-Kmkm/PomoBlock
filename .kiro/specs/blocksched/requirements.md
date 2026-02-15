# 要件定義書

## はじめに

PomBlockは、空き時間を「作業枠（ブロック）」として確保し、ポモドーロで実行し、割り込み・未完も自動で吸収して、計画→実行→再計画→振り返りが回る状態を作るWindowsデスクトップアプリケーションです。Google Calendarを時間情報の唯一の真実とし、ルーティーン・テンプレート・ポリシー等の設定はGitで同期します。

## 用語集

- **System**: PomBlockアプリケーション全体
- **Block**: 作業のために確保した時間区間。確定度（draft/soft/hard）を持つ
- **Task**: やることの候補。ブロック開始時に選択される
- **Pomodoro**: 実績記録単位（集中/休憩/中断/再開）
- **Google_Calendar**: 予定とBlocksイベントを保持する外部カレンダーサービス
- **Git_Repository**: ルーティーン/テンプレート/ポリシーを保存するリポジトリ
- **OAuth_Token**: Google Calendar APIアクセス用の認証トークン
- **SyncToken**: Google Calendar APIの差分同期用トークン
- **Policy**: 働き方に応じた最小パラメータセット（勤務時間、優先度ルール等）
- **Routine**: 定期的に実行する作業パターン
- **Template**: ブロック生成時に使用する雛形

## 要件

### 要件1: Google Calendar認証

**ユーザーストーリー:** ユーザーとして、Google Calendarにアクセスするために、OAuth認証を行いたい。

#### 受入基準

1. WHEN ユーザーが初回起動時に認証を要求される THEN THE System SHALL Google OAuthフローを開始する
2. WHEN OAuth認証が成功する THEN THE System SHALL OAuth_Tokenをローカルの安全領域に保存する
3. WHEN 保存されたOAuth_Tokenが有効である THEN THE System SHALL 再認証なしでGoogle_Calendarにアクセスできる
4. WHEN OAuth_Tokenが期限切れまたは無効である THEN THE System SHALL 自動的に再認証フローを開始する
5. THE System SHALL OAuth_TokenをGit_Repositoryに保存しない

### 要件2: Google Calendar同期

**ユーザーストーリー:** ユーザーとして、Google Calendarの予定とBlocksイベントを同期したい。

#### 受入基準

1. WHEN 同期が実行される THEN THE System SHALL SyncTokenを使用して差分のみを取得する
2. WHEN Google_Calendar上でイベントが外部編集される THEN THE System SHALL 次回同期時にその変更を検出して反映する
3. WHEN 同期中にネットワークエラーが発生する THEN THE System SHALL エラーを記録し、次回同期時にリトライする
4. THE System SHALL 同期後に最新のSyncTokenをローカルに保存する
5. WHEN 同期が完了する THEN THE System SHALL ローカルキャッシュを更新する

### 要件3: ブロック生成

**ユーザーストーリー:** ユーザーとして、空き時間に作業ブロックを自動生成したい。

#### 受入基準

1. WHEN 毎朝の自動生成時刻になる THEN THE System SHALL Google_Calendarから当日の予定を取得してブロックを生成する
2. WHEN ユーザーが手動生成を要求する THEN THE System SHALL 指定された期間のブロックを生成する
3. WHEN ブロックを生成する THEN THE System SHALL 既存の予定と重複しない空き時間を計算する
4. WHEN ブロックを生成する THEN THE System SHALL Policyに基づいて勤務時間内の空き枠のみを対象とする
5. WHEN ブロックを生成する THEN THE System SHALL 生成したブロックをGoogle_Calendarに"draft"確定度で登録する
6. WHEN 同じ時間帯に既にブロックが存在する THEN THE System SHALL 重複生成を防止する

### 要件4: ブロック確認と承認

**ユーザーストーリー:** ユーザーとして、生成されたブロックを確認し、30秒以内で承認または調整したい。

#### 受入基準

1. WHEN ブロックが生成される THEN THE System SHALL ユーザーに確認UIを表示する
2. WHEN ユーザーがブロックを承認する THEN THE System SHALL 確定度を"soft"に更新してGoogle_Calendarに反映する
3. WHEN ユーザーがブロックを削除する THEN THE System SHALL Google_Calendarから該当ブロックを削除する
4. WHEN ユーザーがブロックの時間を調整する THEN THE System SHALL Google_Calendar上のイベント時刻を更新する
5. THE System SHALL 確認から承認までの操作を30秒以内で完了できるUIを提供する

### 要件5: ポモドーロ実行

**ユーザーストーリー:** ユーザーとして、ブロック内でポモドーロタイマーを使って作業を実行したい。

#### 受入基準

1. WHEN ユーザーがブロックを開始する THEN THE System SHALL ポモドーロタイマーを起動する
2. WHEN ポモドーロタイマーが動作中である THEN THE System SHALL 残り時間をリアルタイムで表示する
3. WHEN 集中時間が終了する THEN THE System SHALL 休憩時間を自動的に開始する
4. WHEN ユーザーがポモドーロを中断する THEN THE System SHALL 中断時刻と理由を記録する
5. WHEN ポモドーロが完了または中断される THEN THE System SHALL 実績（開始/終了/中断/再開）をローカルログに記録する

### 要件6: タスク選択（Just-in-time）

**ユーザーストーリー:** ユーザーとして、ブロック開始時に実行するタスクを選択したい。

#### 受入基準

1. WHEN ユーザーがブロックを開始する THEN THE System SHALL 利用可能なタスク一覧を表示する
2. WHEN ユーザーがタスクを選択する THEN THE System SHALL 選択されたタスクをブロックに関連付ける
3. WHEN タスクが選択される THEN THE System SHALL タスク情報をローカルログに記録する
4. THE System SHALL ブロック開始前にタスクを事前割り当てしない

### 要件7: 割り込み処理

**ユーザーストーリー:** ユーザーとして、予定外の会議や割り込みが発生した際に、ブロックを自動的に再配置したい。

#### 受入基準

1. WHEN Google_Calendar上に新しい予定が追加される THEN THE System SHALL 次回同期時にその予定を検出する
2. WHEN 新しい予定が既存ブロックと重複する THEN THE System SHALL 重複するブロックを別の空き時間に再配置する
3. WHEN 再配置先の空き時間が不足する THEN THE System SHALL ユーザーに通知して手動調整を促す
4. WHEN ブロックが再配置される THEN THE System SHALL Google_Calendar上のイベントを更新する

### 要件8: 未完タスクの繰り越し

**ユーザーストーリー:** ユーザーとして、ブロック内で完了しなかったタスクを次のブロックに繰り越したい。

#### 受入基準

1. WHEN ブロックが終了時にタスクが未完である THEN THE System SHALL ユーザーに繰り越しまたは分割を提案する
2. WHEN ユーザーが繰り越しを選択する THEN THE System SHALL タスクを次の利用可能なブロックに関連付ける
3. WHEN ユーザーが分割を選択する THEN THE System SHALL タスクを複数の小タスクに分割して記録する
4. THE System SHALL 繰り越しまたは分割の履歴をローカルログに記録する

### 要件9: ルーティーン・テンプレート管理

**ユーザーストーリー:** ユーザーとして、定期的な作業パターンをルーティーンやテンプレートとして保存し、Git経由で同期したい。

#### 受入基準

1. WHEN ユーザーがルーティーンを作成する THEN THE System SHALL ルーティーン定義をGit_Repositoryに保存する
2. WHEN ユーザーがテンプレートを作成する THEN THE System SHALL テンプレート定義をGit_Repositoryに保存する
3. WHEN Git_Repositoryが更新される THEN THE System SHALL 次回起動時または手動同期時に最新の設定を取得する
4. THE System SHALL ルーティーンとテンプレートをJSON形式で保存する
5. THE System SHALL 機微な情報（OAuth_Token、詳細ログ）をGit_Repositoryに保存しない

### 要件10: ポリシー管理

**ユーザーストーリー:** ユーザーとして、働き方に応じたポリシー（勤務時間、優先度ルール等）を設定し、Git経由で同期したい。

#### 受入基準

1. WHEN ユーザーがポリシーを設定する THEN THE System SHALL ポリシー定義をGit_Repositoryに保存する
2. WHEN ブロック生成時である THEN THE System SHALL Policyに基づいて勤務時間窓を適用する
3. WHEN ユーザーがポリシーを上書きする THEN THE System SHALL ユーザー指定値を優先する
4. THE System SHALL ポリシーをJSON形式で保存する

### 要件11: ローカルデータ管理

**ユーザーストーリー:** ユーザーとして、詳細ログやキャッシュをローカルに安全に保存したい。

#### 受入基準

1. WHEN ポモドーロ実績が記録される THEN THE System SHALL 詳細ログをローカルストレージに保存する
2. WHEN Google_Calendarから取得したデータをキャッシュする THEN THE System SHALL ローカルストレージに保存する
3. THE System SHALL OAuth_TokenをOSの安全領域（Windows Credential Manager等）に保存する
4. THE System SHALL 詳細ログとキャッシュをGit_Repositoryに保存しない
5. WHEN ユーザーがデータ削除を要求する THEN THE System SHALL ローカルストレージから該当データを削除する

### 要件12: UI応答性

**ユーザーストーリー:** ユーザーとして、アプリケーションが常に応答性を保ち、操作がスムーズであることを期待する。

#### 受入基準

1. WHEN ユーザーがUI操作を行う THEN THE System SHALL 100ms以内に視覚的フィードバックを提供する
2. WHEN 長時間処理（同期、ブロック生成）が実行される THEN THE System SHALL プログレスインジケーターを表示する
3. WHEN バックグラウンド処理が実行される THEN THE System SHALL UIスレッドをブロックしない
4. THE System SHALL 毎日のブロック生成から確認までを30秒以内で完了できる

### 要件13: エラーハンドリング

**ユーザーストーリー:** ユーザーとして、エラーが発生した際に適切な通知と回復手段を提供してほしい。

#### 受入基準

1. WHEN ネットワークエラーが発生する THEN THE System SHALL エラーメッセージをユーザーに表示し、ローカルログに記録する
2. WHEN Google Calendar API呼び出しが失敗する THEN THE System SHALL リトライロジックを実行する
3. WHEN 致命的エラーが発生する THEN THE System SHALL エラー詳細をローカルログに記録し、安全に終了する
4. WHEN データ破損が検出される THEN THE System SHALL ユーザーに通知し、バックアップからの復元を提案する

### 要件14: 外部編集の許容

**ユーザーストーリー:** ユーザーとして、Google Calendar上で直接イベントを編集しても、アプリケーションが破綻しないことを期待する。

#### 受入基準

1. WHEN Google_Calendar上でブロックが削除される THEN THE System SHALL 次回同期時にローカルキャッシュから該当ブロックを削除する
2. WHEN Google_Calendar上でブロックの時刻が変更される THEN THE System SHALL 次回同期時にローカルキャッシュを更新する
3. WHEN Google_Calendar上でブロックが復活される THEN THE System SHALL 重複生成を防止し、既存ブロックを維持する
4. THE System SHALL 外部編集による変更を検出し、ユーザーに通知する

### 要件15: 振り返り機能

**ユーザーストーリー:** ユーザーとして、過去のポモドーロ実績を振り返り、生産性を分析したい。

#### 受入基準

1. WHEN ユーザーが振り返りを要求する THEN THE System SHALL 指定期間のポモドーロ実績を集計して表示する
2. WHEN 振り返りデータを表示する THEN THE System SHALL 完了数、中断数、総作業時間を含める
3. THE System SHALL 振り返りデータをグラフまたはテーブル形式で表示する
4. WHEN ユーザーが詳細を要求する THEN THE System SHALL 個別のポモドーロログを表示する
