// チー牛カウンター LINE通知
//   POST /line-notify/webhook … LINE Messaging API の Webhook（グループIDを自動保存）
//   POST /line-notify/notify  … DBトリガーから {log_id} を受け取り、グループに push
import { createClient } from "jsr:@supabase/supabase-js@2";

const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const LINE_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const APP_URL = "https://ace0110-m.github.io/chigyu/";
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ---------- LINE API ----------
async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!LINE_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(LINE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

async function linePush(to: string, messages: unknown[]) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
}

async function lineReply(replyToken: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
}

// ---------- 設定 ----------
async function getSetting(key: string): Promise<string | null> {
  const { data } = await sb.from("chigyu_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(key: string, value: string | null) {
  await sb.from("chigyu_settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

// ---------- Webhook ----------
async function handleWebhook(req: Request) {
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-line-signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  const body = raw ? JSON.parse(raw) : { events: [] };
  for (const ev of body.events ?? []) {
    const src = ev.source ?? {};
    const groupId: string | undefined = src.groupId ?? src.roomId;
    if (ev.type === "join" && groupId) {
      await setSetting("line_group_id", groupId);
      if (ev.replyToken) await lineReply(ev.replyToken, "🍚 チー牛カウンターの通知をこのグループに送ります！");
    } else if (ev.type === "leave" && groupId) {
      const current = await getSetting("line_group_id");
      if (current === groupId) await setSetting("line_group_id", null);
    } else if (ev.type === "message" && groupId) {
      // すでにグループにいた場合も、何か発言があればそのグループを記憶する
      const current = await getSetting("line_group_id");
      if (!current) await setSetting("line_group_id", groupId);
    }
  }
  return json({ ok: true });
}

// LINEの画像メッセージ: 本体10MB以下・プレビュー1MB以下・https必須
async function contentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length"));
    return Number.isFinite(len) ? len : null;
  } catch { return null; }
}
async function buildImageMessage(url: string | null) {
  if (!url?.startsWith("https://")) return null;
  const origSize = await contentLength(url);
  if (origSize === null || origSize > 10 * 1024 * 1024) return null;
  // アプリが同時にアップロードするサムネ（_thumb.jpg）があればプレビューに使う
  const thumbUrl = url.replace(/\.jpg$/, "_thumb.jpg");
  const thumbSize = thumbUrl !== url ? await contentLength(thumbUrl) : null;
  const preview = thumbSize !== null && thumbSize <= 1024 * 1024 ? thumbUrl
    : origSize <= 1024 * 1024 ? url
    : null;
  if (!preview) return null;
  return { type: "image", originalContentUrl: url, previewImageUrl: preview };
}

// ---------- 通知 ----------
async function handleNotify(req: Request) {
  const { log_id } = await req.json().catch(() => ({}));
  if (!log_id) return json({ error: "log_id required" }, 400);

  const { data: log } = await sb
    .from("chigyu_logs")
    .select("id, delta, kind, evidence_url, notified_at, member:chigyu_members(id, name, remaining)")
    .eq("id", log_id)
    .maybeSingle();
  if (!log) return json({ error: "log not found" }, 404);
  if (log.kind !== "eat" || log.notified_at) return json({ skipped: true });

  const groupId = await getSetting("line_group_id");
  if (!groupId) return json({ error: "line_group_id not set (Botをグループに招待してください)" }, 409);

  const member = log.member as unknown as { id: string; name: string; remaining: number };
  // 今月クリア杯数（JST基準）
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 9 * 60 * 60 * 1000).toISOString();
  const { data: monthLogs } = await sb
    .from("chigyu_logs").select("delta").eq("member_id", member.id).eq("kind", "eat").gte("created_at", monthStart);
  const eaten = (monthLogs ?? []).reduce((s, l) => s - l.delta, 0);

  const n = Math.abs(log.delta);
  const headline = member.remaining === 0
    ? `🎉 ${member.name} が ${n}杯 食べて完食！残り 0杯（今月 ${eaten}杯クリア）`
    : `🍚 ${member.name} が ${n}杯 食べた！\n残り ${member.remaining}杯（今月 ${eaten}杯クリア）`;
  const text = `${headline}\n\n${APP_URL}`;

  const messages: unknown[] = [{ type: "text", text }];
  const image = await buildImageMessage(log.evidence_url);
  if (image) messages.push(image);

  await linePush(groupId, messages);
  await sb.from("chigyu_logs").update({ notified_at: new Date().toISOString() }).eq("id", log.id);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    if (req.method === "POST" && path.endsWith("/webhook")) return await handleWebhook(req);
    if (req.method === "POST" && path.endsWith("/notify")) return await handleNotify(req);
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
