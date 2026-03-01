# Routine Studio UX/UI レビュー

**日付：** 2026-03-01  
**対象：** `src-ui/app.js` `renderRoutines()` 関数 ／ `src-ui/styles.css` `.routine-studio-*` セクション

---

## 概要

Routine Studio ページは 3 カラムレイアウト（Library ／ Canvas ／ Intel）で構成されているが、現状はいくつかの設計上の問題により **レイアウト崩壊・情報過密・操作困難** が起きている。以下に各問題を優先度順に整理する。

---

## 問題一覧

### 🔴 高優先度

#### 1. Module Editor が Library パネル内にベタ展開される

**場所：** `app.js` `renderRoutines()` 内、`studio.moduleEditor` の条件分岐  
**場所：** `styles.css` `.rs-module-editor`

**現象：**  
`New Module` または `Edit` を押すと、幅 220〜300px の `rs-library` 列の中にフルフォームが展開される。

展開されるフィールド数：
- テキスト入力 × 5（ID / Name / Category / Minutes / Icon）
- セレクト × 2（Type / Overrun）
- テキストエリア × 2（Description / Checklist）
- Pomodoro モード時は数値入力を追加 × 5
- チェックボックス × 3（Execution Hints）

**影響：**  
フォームが縦に無限増殖し、Asset リストが画面外に押しやられる。モジュール一覧を参照しながら編集できない。

**推奨修正：**  
- モーダルダイアログに切り出す（最も確実）
- または右の Intel パネルを条件付きで「編集ドロワー」として使い回す

---

#### 2. 3カラムの中間ブレークポイントでレイアウト崩壊

**場所：** `styles.css` L1307（`.routine-studio-layout`）、L2496（`@media max-width: 1220px`）

**現象：**  
ウィンドウ幅 981〜1220px で Intel パネルが `grid-column: 1 / -1` にフォールバックし、2行レイアウトになる。しかし Library と Canvas が上段に残るため比率が崩れる。Tauri のデフォルトウィンドウサイズがこの帯域に入りやすく、最も頻繁に発生する。

```css
/* 現状 */
@media (max-width: 1220px) and (min-width: 981px) {
  .routine-studio-layout {
    grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
  }
  .rs-intel {
    grid-column: 1 / -1;
    border-left: none;
    border-top: 1px solid var(--line);
  }
}
```

**推奨修正：**  
- ブレークポイントを `1220px` → `1400px` に引き上げる
- または中間帯では「2カラム（Library + Canvas）＋ Intel を Canvas 下部に折りたたみ」に切り替える

---

### 🟡 中優先度

#### 3. Canvas カード詳細フォームが複数カード同時に全展開される

**場所：** `app.js` Canvas カード `<details>` の展開条件

```javascript
<details class="rs-canvas-details"
  ${studio.selectedEntryId === entry.entryId || index === 0 ? "open" : ""}>
```

**現象：**  
選択中カードだけでなく index === 0 のカードも常に開いた状態になる。各カードの詳細フォームには input × 3・select × 3・textarea × 2・fieldset が含まれており、ステップが複数あると Canvas が縦に大きく膨らむ。カード間の Drag & Drop が実質困難になる。

**推奨修正：**  
- `index === 0` の特別扱いを廃止し、`is-selected` のカードのみ open にする
- 未選択カードはタイトル・所要時間・ステップ番号のみのコンパクト表示（collapsed view）にする

---

#### 4. Intel パネルのフッターボタンが画面外に隠れる

**場所：** `app.js` `.rs-intel-actions`、`styles.css` L1747

**現象：**  
Intel パネルの下部フッターに4つのボタンが `display: grid` で縦積みされており、パネルの高さが足りないときに一番下の "Delete Template" / "Clear Canvas" どころか "Save as Template" も見えなくなることがある。

```html
<footer class="rs-intel-actions">
  <button>Save as Template</button>   ← 最重要なのに一番上
  <button>Apply to Today</button>
  <button>Delete Template</button>
  <button>Clear Canvas</button>
</footer>
```

**推奨修正：**  
- Properties セクションを `<details>` で折りたたみ可能にしてスクロール量を削減する
- "Save as Template" を `position: sticky; bottom: 0` にして常時表示を保証する
- "Delete Template" / "Clear Canvas" は破壊的操作なので目立たない位置（ghost ボタン或いはコンテキストメニュー）に移動する

---

### 🟢 低優先度

#### 5. アセットカードのボタン3つが狭い列でオーバーフロー

**場所：** `app.js` `.rs-asset-actions`（`Add` / `Edit` / `Delete` ボタン）

**現象：**  
220〜300px の Library 列内で3つのテキストボタンが横並びになれず折り返す。`rs-asset-actions` に `flex-wrap` が指定されていないため、小さいウィンドウ幅ではボタンが列幅をはみ出す。

**推奨修正：**  
- `Add` のみテキストボタンを残す
- `Edit` / `Delete` を 28px のアイコンボタン（`.rs-icon-btn`）に変更する
- または3点（⋯）メニューに格納する

---

#### 6. テンプレートカードのサブタイトルに内部 ID を表示

**場所：** `app.js` テンプレートアセットカードのサブタイトル生成

```javascript
// 現状
`${escapeHtml(template.id)} / ${template.stepCount} steps / ${escapeHtml(template.autoDriveMode)}`
```

**現象：**  
`rcp-morning-routine / 5 steps / manual` のように内部 ID がユーザーに見える。ID はシステム内部の識別子であり、UX 的に価値がない。

**推奨修正：**  

```javascript
`${template.stepCount} steps • ${escapeHtml(template.autoDriveMode)}`
```

---

#### 7. UI 内の言語が混在している

**現象：**  
同一画面内で日本語と英語が混在しており、一貫性がない。

| 要素 | 言語 |
|---|---|
| Toolbar 説明文「部品（モジュール）を選んで、組み立てる…」 | 日本語 |
| フォームラベル（Title / Minutes / Type / Overrun…） | 英語 |
| Canvas 空状態「左側のAdd / Insertからも追加できます。」 | 日本語 |
| アクションボタン（Save as Template / Apply to Today…） | 英語 |

**推奨修正：**  
言語方針を決定し統一する。日本語 UI にするならラベル・ボタン・説明文をすべて日本語化する（または i18n 対応）。

---

## 優先度サマリー

| 優先度 | 問題 | 主な影響 |
|---|---|---|
| 🔴 High | Module Editor が Library 内に展開 | レイアウト崩壊・スクロール地獄 |
| 🔴 High | 3カラムの中間ブレークポイント崩壊 | デスクトップでの常時発生 |
| 🟡 Mid | Canvas カードが複数同時全展開 | スクロール量増大・DnD 困難 |
| 🟡 Mid | Intel フッターボタンが非表示になる | Save 操作へのアクセス喪失 |
| 🟢 Low | アセットカードの3ボタンオーバーフロー | サイドバーのレイアウト崩れ |
| 🟢 Low | テンプレートカードに内部 ID 表示 | 情報ノイズ |
| 🟢 Low | UI 内の言語混在 | 一貫性の欠如 |

---

## 参照ファイル

- `src-ui/app.js` — `renderRoutines()` 関数（L3784〜）
- `src-ui/styles.css` — `.routine-studio-*`（L1245〜）、レスポンシブ（L2462〜、L2496〜）
