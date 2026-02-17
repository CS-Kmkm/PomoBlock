# PomBlock

PomBlock は、Tauri ベースのデスクトップアプリです。  
Rust バックエンドで認証・同期・ブロック管理を扱い、TypeScript UI で操作します。

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

### Rust 側チェック

```powershell
npm run rust:check
```

### Tauri アプリ起動 (開発)

```powershell
cd src-tauri
cargo tauri dev
```

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
