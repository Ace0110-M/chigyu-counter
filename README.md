# チー牛カウンター 🍚🧀

友達同士で「あと何杯チー牛を食べないといけないか」を数えるアプリ。

- 残り杯数の表示・±1杯の調整
- 食べた記録（写真・レシート付き）を入力して杯数を減らす
- ニックネームだけで登録、誰でも誰の杯数もいじれる
- みんなの残りがリアルタイムで同期
- スマホのホーム画面に追加してアプリのように使える（PWA）

## 構成

- フロントエンド: 静的 HTML / CSS / JS（GitHub Pages）
- バックエンド: Supabase（Postgres + Storage + Realtime）
  - `chigyu_members` … メンバーと残り杯数
  - `chigyu_logs` … 増減の履歴と証拠画像URL
  - `chigyu_adjust()` … 杯数の更新と履歴記録をまとめて行う関数
  - `chigyu-evidence` バケット … 証拠画像

`config.js` の publishable key は公開前提のキーです（RLS で保護）。

## ローカルで動かす

```bash
python3 -m http.server 8765
```

http://localhost:8765 を開く。

## LINE通知

食べた記録（`kind='eat'`）が入ると、DBトリガー（pg_net）→ Edge Function `line-notify` → LINE Messaging API でグループトークに通知する。

- `supabase/functions/line-notify/index.ts` … Webhook受信（グループID自動保存）と push 送信
- `chigyu_settings` … `line_group_id` を保持（anon からはアクセス不可）
- Secrets（Supabaseダッシュボードで設定）: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`
- LINE の Webhook URL: `https://<project>.supabase.co/functions/v1/line-notify/webhook`
