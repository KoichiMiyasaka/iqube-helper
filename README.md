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

## 祝日判定

祝日リストはハードコードしていません。
**iQube画面で赤色表示されている日（`<td class="holiday">`）を動的に判定**しています。

メリット:
- 年次メンテナンス不要（2028年問題なし）
- 会社の独自休日（年末年始・創立記念日など）も自動対応
- iQube の判定基準と完全一致

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

---

# 🤖 完全自動化オプション（上級者向け）

「ブックマークレットをクリックする」操作すら省きたい場合、PCのスケジューラと headless ブラウザを組み合わせれば **完全自動化** できる。

## 前提条件

- PC が指定時刻に起動している（スリープ含む。スリープからの自動復帰設定が必要）
- iQube に外部からアクセス可能（社内VPN/IP制限なしの場合）
- 2要素認証なし（メール+パスワードのみで入る）

> ⚠️ **動作は完全に自己責任**。実態と異なる打刻は就業規則違反になる可能性があります。

## アーキテクチャ

```
[ OSスケジューラ ] 毎日19:00トリガー
       ↓
[ Node.js + Playwright ] headless Chrome 起動
       ↓ ログイン（ID/PWは OS Keychain から取得）
[ iQube ページに loader.js を注入 ]
       ↓ bulkPunch([today], ...) を実行
       ↓ 祝日・備考あり日は loader.js が自動スキップ
[ 終了 ]
```

---

## 🍎 macOS 版

### 必要なもの

```bash
# Node.js（未インストールの場合）
brew install node

# Playwright
mkdir -p ~/iqube-clock && cd ~/iqube-clock
npm init -y
npm install playwright
npx playwright install chromium
```

### 認証情報を macOS Keychain に保存

```bash
# email
security add-generic-password -a "$USER" -s "iqube-email" -w "your.email@example.com"

# password
security add-generic-password -a "$USER" -s "iqube-password" -w "yourPasswordHere"
```

> 🔐 Keychain に暗号化保存されるので、`.env` ファイルより安全。

### スクリプト本体

`~/iqube-clock/iqube-clock.mjs`:

```javascript
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const LOG_DIR = `${process.env.HOME}/.iqube-clock-log`;
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = `${LOG_DIR}/${new Date().toISOString().slice(0,10)}.log`;
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(line.trim());
};

const sec = (name) =>
  execSync(`security find-generic-password -a "$USER" -s "${name}" -w`).toString().trim();

const EMAIL = sec('iqube-email');
const PASSWORD = sec('iqube-password');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    log('iQube ログインページへ');
    await page.goto('https://app.iqube.net/login'); // ← 実際のログインURLに合わせる
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    log('time_cards ページへ');
    await page.goto('https://app.iqube.net/time_cards');
    await page.waitForLoadState('networkidle');

    log('loader.js を注入');
    await page.addScriptTag({
      url: `https://koichimiyasaka.github.io/iqube-helper/loader.js?v=${Date.now()}`,
    });
    await page.waitForTimeout(2000);

    log('今日打刻ボタンをクリック');
    await page.click('#iqhRunToday');
    await page.waitForTimeout(5000); // bulkPunch の完了を待つ

    log('✅ 打刻処理完了');
  } catch (e) {
    log(`❌ エラー: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
```

### launchd で毎日19時に実行

`~/Library/LaunchAgents/com.user.iqube-clock.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.iqube-clock</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/YOURNAME/iqube-clock/iqube-clock.mjs</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>19</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/iqube-clock.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/iqube-clock.err.log</string>
</dict>
</plist>
```

登録:

```bash
launchctl load ~/Library/LaunchAgents/com.user.iqube-clock.plist
launchctl list | grep iqube  # 確認
```

### スリープからの自動復帰

「システム設定」→「バッテリー」→「スケジュール」で、毎日18:55に自動復帰するよう設定。
または:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 18:55:00
```

---

## 🪟 Windows 版

### 必要なもの

```powershell
# Node.js（https://nodejs.org/ からインストール）

# Playwright
mkdir C:\iqube-clock
cd C:\iqube-clock
npm init -y
npm install playwright
npx playwright install chromium
```

### 認証情報を Windows 資格情報マネージャーに保存

PowerShellで:

```powershell
cmdkey /generic:iqube-email /user:dummy /pass:"your.email@example.com"
cmdkey /generic:iqube-password /user:dummy /pass:"yourPasswordHere"
```

または PowerShell の `SecureString` で:

```powershell
# 初回のみ実行
$cred = Get-Credential -UserName "your.email@example.com" -Message "iQube認証情報"
$cred | Export-Clixml -Path "$env:USERPROFILE\.iqube-cred.xml"
```

> 🔐 `Export-Clixml` で保存されるファイルは Windows DPAPI で暗号化され、同じユーザーアカウントからのみ復号可能。

### スクリプト本体

`C:\iqube-clock\iqube-clock.mjs`（macOS版とほぼ同じ、認証情報取得部分のみ変更）:

```javascript
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.join(process.env.USERPROFILE, '.iqube-clock-log');
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `${new Date().toISOString().slice(0,10)}.log`);
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(line.trim());
};

// PowerShell経由でDPAPI暗号化されたcredentialを読み込む
const credPath = path.join(process.env.USERPROFILE, '.iqube-cred.xml');
const psCmd = `$c = Import-Clixml '${credPath}'; Write-Output $c.UserName; Write-Output $c.GetNetworkCredential().Password`;
const [EMAIL, PASSWORD] = execSync(`powershell -Command "${psCmd}"`)
  .toString().trim().split(/\r?\n/);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    log('iQube ログインページへ');
    await page.goto('https://app.iqube.net/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    log('time_cards ページへ');
    await page.goto('https://app.iqube.net/time_cards');
    await page.waitForLoadState('networkidle');

    log('loader.js を注入');
    await page.addScriptTag({
      url: `https://koichimiyasaka.github.io/iqube-helper/loader.js?v=${Date.now()}`,
    });
    await page.waitForTimeout(2000);

    log('今日打刻ボタンをクリック');
    await page.click('#iqhRunToday');
    await page.waitForTimeout(5000);

    log('✅ 打刻処理完了');
  } catch (e) {
    log(`❌ エラー: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
```

### タスクスケジューラで毎日19時に実行

PowerShell（管理者）で:

```powershell
$action = New-ScheduledTaskAction `
  -Execute "node.exe" `
  -Argument "C:\iqube-clock\iqube-clock.mjs" `
  -WorkingDirectory "C:\iqube-clock"

$trigger = New-ScheduledTaskTrigger -Daily -At 19:00

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive

Register-ScheduledTask `
  -TaskName "iQube Auto Clock" `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Description "毎日19時にiQubeへ自動打刻"
```

確認・削除:

```powershell
Get-ScheduledTask -TaskName "iQube Auto Clock"
# 削除する場合
Unregister-ScheduledTask -TaskName "iQube Auto Clock" -Confirm:$false
```

### スリープからの自動復帰

タスクスケジューラのGUIで対象タスクのプロパティ → 「条件」タブ → **「タスクを実行するためにスリープを解除する」** にチェック。

---

## 🛡 共通の注意事項

1. **PC が起動していないと動かない**
   - 出張・休暇でPCオフだとその日は手動打刻になる
   - Mac/Windows ともスリープ自動復帰の設定で緩和可能

2. **iQube側のUI変更で動かなくなる可能性**
   - ログインフォームのname属性変更、URL変更などで停止
   - 月1回程度、手動でログ確認 (`~/.iqube-clock-log/`) を推奨

3. **打刻失敗時のリカバリ**
   - エラー時もログのみで通知なし（設計通り）
   - 翌日に手動でブックマークレットを開き、月一括打刻で前日分も補完可能

4. **就業規則の確認**
   - 「実態と異なる打刻」は懲戒対象になり得る
   - 残業・遅刻・早退・有給など、実態と違う日はツール起動前にiQubeで先に修正しておく

5. **コードは Mac/Windows ともプライベートPCのローカルに置く**
   - GitHub等の公開リポジトリに認証情報込みで上げないこと

---

## ❓ 想定FAQ

**Q. スマホからは自動化できる？**  
A. iPhone/Android 単体では実用的な手段なし。PCを使うこと。

**Q. クラウド（GitHub Actions等）で動かせる？**  
A. iQubeのIP制限がなければ理論的には可能。ただしID/PWを外部サービスに置くリスクが高く非推奨。

**Q. ログインセッションをCookieで保持すれば毎回ログイン不要では？**  
A. 可能。Playwright の `storageState` で保存・復元できる。ただしセッション期限切れ時の挙動を実装する必要あり。

