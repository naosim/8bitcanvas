## 要件
- 無限の広さを持つキャンバスアプリ
- UIが8bitでかわいい
- 出力ファイル形式はJSON Canvas (Obsidian Canvas形式)
- 機能
  - JSON Canvasを編集できる基本的な機能
  - undo/redo
  - ズーム
- 技術
  - TypeScript / vanilla CSS / HTML
  - 保存先はローカルファイル(DL)、LocalStorage

## 設計

### 対応フォーマット
Obsidian Canvas形式
- ノード：テキスト、点
- 線：矢印（始点/終点）

### UIデザイン
- ピクセルサイズ：16x16
- キャンバスサイズ：256x256（論理ピクセル）
- 配色：ファミコン風（限られたパレット）
- フォント：DotGothic16（Webフォント）
- メニュー配置：下部
- ツールバー：アクションボタン配置（テキスト、点など）
- プロパティバー：選択項目の編集フォーム配置

### キャンバス仕様
- 原点：画面の中心 (0, 0)
- 無限キャンバス：パンとズームで移動可能

### 基本機能

#### ノード作成・編集・削除
- テキストノード：ダブルクリックでテキスト編集、角丸（R=4）
- 点ノード：3ドット（12px）
- テキスト配置：横方向（左揃え/中央揃え/右揃え）、縦方向（上揃え/中央揃え/下揃え）
- 自動サイズ調整：テキストがはみ出す場合、 автоматически拡大（チェックボックスで切り替え可能）
- マウスでサイズ変更可能（自動サイズをオフにした場合）

#### カラー指定
- **8色カラーパレット**：背景8色のパレット（線は常に白、選択中は黄色）
- **パレット編集**：
  - パレットを**ダブルクリック** → ブラウザ標準のカラーピッカーが開く
  - カラーピッカーで色を選択 → パレットの色が更新される
  - パレット色は全ノード共通（1つのパレットを編集すると、その色を使っている全ノードに影響）

#### テキストノードの特殊機能
- **背景透明化**：チェックボックスで背景を透明にできる
- **線透明化**：チェックボックスで枠線を透明にできる（点ノードは常に白線）

#### 線作成・削除
- 作成方法：SHIFT押しながら2つのノードを選択→線ボタンクリック
- 線編集：選択した線のプロパティで「始点矢印/終点矢印」を切り替え
- 線は点の中心から出る
- 線は常に点の前面に表示
- 線の太さはノードと同じ

#### 選択・移動
- 単一選択：クリック
- 複数選択：SHIFT+クリック
- 削除：DeleteキーまたはBackspaceキー（テキスト入力中は無効）
- 線選択：線上のクリックで選択

#### パン
- キャンバス上の何もない部分をドラッグしてパン移動

#### ファイル入出力
- ファイル保存（JSON Canvas形式）
- ファイル読み込み（.json, .canvas対応）
- JSONをコンソールに出力（Logボタン）
- LocalStorageへの自動保存

#### 表示高速化
- ズーム率が0.3以下の時、テキストを描画しない
- 画面外のノード/線は描画しない
- ズーム範囲：0.1〜5

#### Obsidian向けエクスポート
- 点ノードはObsidianで表示できないため、テキストノードとして出力
- ファイル読み込み時、幅・高さが20以下のノードは点として復元

#### 開発者機能
- URLに `?dev=true` を追加、または `localStorage.setItem('8bitcanvas-dev', 'true')` で開発者モード有効化
- CLRボタンでLocalStorageをクリア可能

#### UI
- 選択項目の重なり順序変更（最前面/最背面）。線よりは後ろ

## コーディング規約

### 技術スタック
- TypeScript で実装
- コンパイル: `npm run build` → `dist/app.js`
- 厳格なタイプチェック (strict mode)

### 変数宣言
- `const` を優先し、`let` は再代入が必要な場合のみ使用
- グローバル変数の使用を避ける

### 関数設計
- **最大2パラメータ**: 関数は最大2つの引数を取る
- **context オブジェクト使用**: より多くのデータが必要な場合、複数のパラメータの代わりに `context` オブジェクト `{ state, app }` を渡す
- **point オブジェクト使用**: 座標を個別の x, y パラメータではなく `{ x, y }` オブジェクトにまとめる

### グローバル状態管理
- 状態は単一の `state` オブジェクトに格納
- アプリ参照（canvas, ctx, fileInput）は `app` オブジェクトに格納
- それらを `context` オブジェクトに統合: `const context = { state, app }`
- 関数には `context` を渡し、グローバル参照を避ける

### クラス設計
- 状態を持つコンポーネントにはクラスを使用（例: `HistoryManager`）
- 単一責任を維持

### 命名規則
- 関数: camelCase（例: `handleMouseDown`, `screenToWorld`）
- クラス: PascalCase（例: `HistoryManager`）
- 定数:  magic number は UPPER_SNAKE_CASE、 その他は camelCase
- オブジェクト: camelCase（例: `state`, `app`, `context`）

### コードスタイル
- セミコロンを一貫して使用
- 文字列には単一引用符
- スペース2文字でインデント
- 末尾の空白なし

### 単位と座標系

#### ドット, PIXEL_SIZE, px の関係
- **1ドット** = 論理的な最小単位（世界の座標系）
- **PIXEL_SIZE** = 1ドットを画面上で表現するピクセル数（現在4px）
- **px** = 画面上の実際のピクセル

```
例: 8ドット移動 = PIXEL_SIZE * 8 = 4 * 8 = 32px
```

ノードの座標はドット単位で管理し、画面描画時にPIXEL_SIZEを乗じてpxに変換する。

### UIレイアウト仕様

#### プロパティパネルの構成
- `#node-props`（テキストノード用）と `#edge-props`（線用）の2つのパネルがある
- 選択状態に応じてプログラムで`display`を切り替え
- **テキストノード選択時**：
  - テキスト入力、位置指定、自動サイズの3つのフィールドを表示
  - `#text-props`でグループ化し、`display: contents`でflexアイテムを直通させる
  - `display: contents`使えない場合はJSで`display: contents`を给她设置
- **点ノード選択時**：テキスト関連フィールドを非表示

#### 新しいUI要素追加時の考慮事項
- 既存のflexboxレイアウトへの影響を検討
- `display: contents`を使ってレイアウトを壊さない手法を活用
- CSSの`flex-wrap: wrap`で折り返し可能にしておく

### context 使用例

```typescript
// GOOD
function handleMouseDown(e: MouseEvent, context: Context): void {
  const { state, app } = context;
  const { canvas } = app;
  // ...
}

// BAD: グローバル変数アクセス
function render(): void {
  ctx.fillRect(0, 0, canvas.width, canvas.height); // NG!
}
```

### 型定義

```typescript
interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}
```

### グローバルオブジェクト構造

```typescript
interface Point {
  x: number;
  y: number;
}

interface CanvasNode {
  id: string;
  type: 'text' | 'dot';
  x: number;
  y: number;
  // ...
}

interface State {
  nodes: CanvasNode[];
  // ...
}

interface App {
  document: Document;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fileInput: HTMLInputElement;
}

const _app: App = {
  document: document,
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  ctx: (document.getElementById('canvas') as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D,
  fileInput: document.getElementById('file-input') as HTMLInputElement
};

const _state: State = {
  nodes: [],
  // ...
};

const context: Context = { state: _state, app: _app };
```