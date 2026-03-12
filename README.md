# PomoBlock

PomoBlock は、Tauri ベースのデスクトップアプリです。  
Rust バックエンドで認証・同期・ブロック管理を扱い、TypeScript UI で操作します。

## Backend Source Of Truth

- 本番 backend の SoT は `src-tauri/` です。
- 新しい backend 機能は Rust にのみ追加します。
- `src/` 配下の Node/TypeScript backend 実装は、移行完了まで reference / legacy 扱いです。
- `src/` 配下の backend ロジックは保守・差分確認・移行補助を目的とし、新規投資先にはしません。
- `npm run init` / `npm run status` は Rust CLI 実装を呼び出します。

## 前提環境

- Node.js 22 以上
- npm
- Rust (cargo / rustc)
- Windows の場合:
  - Visual Studio 2022 Community (Desktop development with C++)
  - Windows SDK (10.0.22621 以上推奨)

依存関係の状態確認:

```powershell
npm run doctor
```

## セットアップ

1. 依存関係をインストールします。

```powershell
npm install
```

2. ワークスペースを初期化します。

```powershell
npm run init
```

3. 状態を確認します。

```powershell
npm run status
```

## 使用方法

### テスト実行

```powershell
npm test
```

残存する Node/TypeScript backend 回帰テストを実行する場合:

```powershell
npm run test:legacy
```

### Rust 側チェック

```powershell
npm run rust:check
```

### Tauri アプリ起動 (開発)

```powershell
cd src-tauri
cargo tauri dev
```

補足:
- `src-tauri/tauri.conf.json` の `beforeDevCommand` で `npm --prefix . run build:ui` を実行するため、
  `cargo tauri dev` 前に手動で UI ビルドする必要はありません。

### Backend 実装の扱い

- UI は `src-ui/`、本番 backend は `src-tauri/` を編集対象にします。
- `src/` は legacy backend / 参照実装として段階的に縮退させます。
- backend 仕様の回帰確認は Rust テストへ集約していきます。

## 設定方法

初期化時に `config/` 配下へ設定ファイルが生成されます。

- `config/app.json`: アプリ基本設定 (timezone など)
- `config/calendars.json`: カレンダーID設定
- `config/policies.json`: 勤務時間・ブロック長・休憩時間などのポリシー
- `config/routines.json`: ルーティーン定義
- `config/templates.json`: テンプレート定義
- `config/overrides.json`: 一時的な上書き設定

Google OAuth を使う場合は、以下の環境変数を設定します。

- `POMBLOCK_GOOGLE_CLIENT_ID`
- `POMBLOCK_GOOGLE_CLIENT_SECRET`
- 任意: `POMBLOCK_GOOGLE_REDIRECT_URI`
- 任意: `POMBLOCK_GOOGLE_SCOPES`

## ビルドとパッケージング (Windows)

Tauri 設定は `src-tauri/tauri.conf.json` にあります。  
本リポジトリではインストーラー形式として `nsis` と `msi` を対象にしています。

### インストーラー生成

```powershell
npm run build:windows
```

出力先:

- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

### デバッグビルド

```powershell
npm run build:windows:debug
```

## Legacy Node Backend

- `src/` 配下の backend モジュールは legacy / reference implementation です。
- `npm run build` は UI ビルドのみを対象にし、Node backend のビルドは本番導線から外しています。
- 残存する Node backend 検証が必要な場合のみ `npm run build:node` または `npm run test:legacy` を使います。
