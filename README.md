# iQube クイック打刻

iQube の勤怠入力をワンクリックで終わらせるブックマークレットツール。
PC（Chrome/Edge/Firefox/Safari）と iPhone Safari に対応。

📦 **インストール手順 → https://koichimiyasaka.github.io/iqube-helper/**

## 機能

- **今日を打刻**: ボタンを押した日の勤怠を即入力
- **月一括打刻**: 選択した月の平日全部を一括入力（土日・祝日除外）
- **日付選択一括**: カンマ区切りまたは範囲指定で複数日を入力
- **定時カスタマイズ**: 端末ごとに出社・退社時刻を変更可能
- **備考あり日の自動スキップ**: 有給休暇など備考が書かれた日は誤上書きされない
- **未来日の自動スキップ**: 明日以降の日は打刻不可

## デフォルト定時

| 項目 | 時刻 |
|---|---|
| 出社 | 09:00 |
| 退社 | 18:00 |
| 外出（休憩開始） | 12:00 |
| 戻り（休憩終了） | 13:00 |

## 定時を変更する方法

### 方法1: 端末ごとに変更（推奨）

ツールパネルの「**設定**」タブから時刻を変更し、「保存」を押す。
変更内容は `localStorage` に保存され、そのブラウザにのみ反映される。

### 方法2: 全員のデフォルトを変更（管理者向け）

[`loader.js`](./loader.js) の冒頭の `DEFAULT_TIMES` を編集して commit する。

```javascript
const DEFAULT_TIMES = {
  arrival:   { hour: 9,  minute: 0  },  // 出社
  leaving:   { hour: 18, minute: 0  },  // 退社
  outing:    { hour: 12, minute: 0  },  // 外出
  returning: { hour: 13, minute: 0  },  // 戻り
};
```

push 後、数分以内にメンバー全員に反映される（ブラウザキャッシュ次第）。
**強制反映したい場合**: ブックマークレット URL の `?v=` パラメータでキャッシュバスティング済みなので、再度ブックマークをクリックすればOK。

## ブックマークレットURL

```
javascript:(()=>{const s=document.createElement('script');s.src='https://koichimiyasaka.github.io/iqube-helper/loader.js?v='+Date.now();document.body.appendChild(s);})();
```

## 祝日リストの更新

`loader.js` 冒頭の `JP_HOLIDAYS` に 2025〜2027 年の祝日が内蔵されています。
**2028年以降を扱うようになったら追記してください**。

祝日データは [内閣府の公式ページ](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html) から取得できます。

```javascript
const JP_HOLIDAYS = new Set([
  // 2028
  '2028-01-01', '2028-01-10', ...
]);
```

## 仕組み

1. ブックマークレットが GitHub Pages から `loader.js` を fetch
2. iQube の認証セッションを利用して `/time_cards` API に PUT リクエスト
3. CSRF トークンはページ内の `meta[name=csrf-token]` から自動取得

```
[ブラウザ] → ブックマークレット → GitHub Pages から loader.js 取得
                ↓
            UI 表示（パネル）
                ↓
            ユーザー操作（日付選択など）
                ↓
            app.iqube.net/time_cards へ PUT（CSRF token 自動付与）
```

## 開発

```bash
git clone git@github.com:KoichiMiyasaka/iqube-helper.git
cd iqube-helper
# loader.js を編集
git add . && git commit -m "..." && git push
```

push 後、数分で GitHub Pages に反映される。

## 注意

- 未来日には打刻できない（自動スキップ）
- 既に打刻済みの日は上書きされる
- iQube のログインセッションが必要
- **このツールは非公式。動作は自己責任で**
