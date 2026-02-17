# PomBlock UI

`src-ui` は Tauri v2 の `frontendDist` として使う静的 SPA です。

- `index.html`: ルーティング付きのシェル
- `styles.css`: レイアウト/タイポグラフィ/アニメーション
- `app.js`: 各画面と Tauri コマンド呼び出し

Tauri 環境では `window.__TAURI__.core.invoke` を使用し、通常ブラウザではモック実装に自動フォールバックします。
