// SYNAPSE AI club bot: subscription via GetCourse, access to channel and chat,
// schedule, onboarding form, tasks, random coffee, impulses and AI assistant.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const DIR = Bun.env.DATA_DIR || "/data";
try { mkdirSync(DIR, { recursive: true }); } catch {}
const DBF = DIR + "/synapse.json";

const TG = Bun.env.TG_TOKEN || "";
const KEY = Bun.env.HOOK_KEY || "";
if (!KEY) console.log("HOOK_KEY is not set");
const PUBLIC = (Bun.env.PUBLIC_URL || "").replace(/\/$/, "");
const OWNER_ID = Number(Bun.env.OWNER_ID || 749890854);
const ADMINS = new Set([OWNER_ID, ...String(Bun.env.ADMINS || "").split(",").map((s) => Number(s.trim())).filter(Boolean)]);
const GC_KEY = Bun.env.GC_KEY || "";
const GC_HOST = (Bun.env.GC_HOST || "olgapuzanova.getcourse.ru").replace(/^https?:\/\//, "").replace(/\/$/, "");
const GC_OFFER = Bun.env.GC_OFFER_CODE || "";
const PRICE = Number(Bun.env.PRICE || 2990);
const MANAGER = Bun.env.MANAGER || "@puzanovateam";
const AI_KEY = Bun.env.ANTHROPIC_API_KEY || "";
const AI_MODEL = Bun.env.AI_MODEL || "claude-haiku-5-5";
const AI_DAILY = Number(Bun.env.AI_DAILY || 30);
const GRACE_MS = 2 * 86400000;
const DAY = 86400000;

// ---------- storage ----------
type U = any;
let db: any = { users: {}, events: [], tasks: [], subs: [], chats: {}, emails: {}, deals: {}, coffee: {} };
try { if (existsSync(DBF)) db = { ...db, ...JSON.parse(readFileSync(DBF, "utf8")) }; } catch (e) { console.log("db read error", e); }
let dirty = false;
function save() { dirty = true; }
setInterval(() => { if (!dirty) return; dirty = false; try { writeFileSync(DBF + ".tmp", JSON.stringify(db)); renameSync(DBF + ".tmp", DBF); } catch (e) { console.log("db write error", e); } }, 1500);

function user(from: any): U {
  const id = String(from.id);
  let u = db.users[id];
  if (!u) { u = db.users[id] = { id: from.id, joined: Date.now(), impulses: 0, coffee: true, status: "new", paidUntil: 0 }; }
  u.username = from.username || u.username || "";
  u.tgName = [from.first_name, from.last_name].filter(Boolean).join(" ") || u.tgName || "";
  return u;
}
const active = (u: U) => u && (ADMINS.has(u.id) || (u.paidUntil && u.paidUntil + GRACE_MS > Date.now()));
const members = () => Object.values(db.users).filter((u: any) => active(u) && !ADMINS.has(u.id)) as U[];
const fmtDate = (ms: number) => new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" });
const fmtDT = (ms: number) => new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const LEVELS: [number, string][] = [[0, "Нейрон"], [300, "Дендрит"], [1000, "Синапс"], [3000, "Нейросеть"], [7000, "Кортекс"]];
function level(n: number) { let l = LEVELS[0]; for (const x of LEVELS) if (n >= x[0]) l = x; const next = LEVELS.find((x) => x[0] > n); return { name: l[1], next }; }
function addImp(u: U, n: number, why: string) { u.impulses = (u.impulses || 0) + n; save(); send(u.id, `⚡️ +${n} импульсов: ${why}. Всего ${u.impulses}, уровень «${level(u.impulses).name}»`); }

// ---------- telegram ----------
async function api(method: string, body: any): Promise<any> {
  if (!TG) return { ok: false, description: "no token" };
  try { const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return await r.json(); }
  catch (e: any) { return { ok: false, description: String(e?.message || e) }; }
}
async function send(chat: any, text: string, extra: any = {}) {
  const parts: string[] = [];
  let t = text;
  while (t.length > 4000) { const cut = t.lastIndexOf("\n", 4000) > 2000 ? t.lastIndexOf("\n", 4000) : 4000; parts.push(t.slice(0, cut)); t = t.slice(cut); }
  parts.push(t);
  let r: any;
  for (let i = 0; i < parts.length; i++) r = await api("sendMessage", { chat_id: chat, text: parts[i], link_preview_options: { is_disabled: true }, ...(i === parts.length - 1 ? extra : {}) });
  return r;
}
const MENU = { keyboard: [[{ text: "📅 Расписание" }, { text: "🎯 Задания" }], [{ text: "🤖 ИИ-помощник" }, { text: "☕ Random Coffee" }], [{ text: "👤 Мой профиль" }, { text: "💳 Подписка" }]], resize_keyboard: true, is_persistent: true };
const ADMIN_MENU = { inline_keyboard: [[{ text: "📅 Добавить событие", callback_data: "adm:event" }, { text: "🎯 Новое задание", callback_data: "adm:task" }], [{ text: "📣 Рассылка", callback_data: "adm:broadcast" }, { text: "🔑 Выдать доступ", callback_data: "adm:grant" }], [{ text: "📊 Статистика", callback_data: "adm:stats" }, { text: "☕ Собрать пары сейчас", callback_data: "adm:coffee" }]] };

const WELCOME = `Привет! Это Оля, и я очень рада видеть тебя в SYNAPSE AI 💙

Синапс это место, где один нейрон передаёт сигнал другому. Здесь всё устроено так же: каждую неделю ты получаешь новую фишку с ИИ, применяешь её в своём деле и делишься результатом с остальными. Так умнеет вся наша сеть.

Что тебя ждёт:
⚡️ по понедельникам фишка недели: новая нейросеть или приём и готовые промпты
🎓 каждый месяц мини-курс: 4 коротких урока и задание
🎙 по четвергам в 19:00 эфир, где я отвечаю на ваши вопросы
💼 SYNAPSE Market: здесь собственники находят исполнителей, а исполнители получают заказы
🏆 импульсы за каждое полезное действие: копишь, растёшь в уровнях и забираешь призы

С чего начать, это займёт 15 минут:
1. Заполни анкету прямо здесь, я соберу маршрут под твою задачу
2. Зайди в канал и чат клуба по ссылкам ниже
3. Загляни в «🎯 Задания» и сделай первое

Если что-то непонятно, пиши в чат клуба. Глупых вопросов тут не бывает, ну почти 😄`;

const ROLES = ["Собственник или селлер", "Исполнитель, хочу заказы", "Сотрудник или менеджер", "Начинаю с нуля"];
const ROUTES: Record<string, string> = {
  "Собственник или селлер": "Твой маршрут на месяц:\n1. Мини-курс месяца, начни с первого урока\n2. Отдай ИИ одну задачу, которая повторяется каждый день и забирает больше 30 минут\n3. Если некогда делать самой, опиши задачу в SYNAPSE Market, исполнители из клуба откликнутся\n4. Приходи в четверг на эфир со своим вопросом",
  "Исполнитель, хочу заказы": "Твой маршрут на месяц:\n1. Пройди мини-курс месяца и сдай все задания, за каждое +50 импульсов и бейдж в профиле\n2. Собери 2-3 работы в портфолио, учебные тоже считаются\n3. Каждую среду смотри новые заказы в SYNAPSE Market\n4. Первый закрытый заказ даёт +200 импульсов",
  "Сотрудник или менеджер": "Твой маршрут на месяц:\n1. Выбери одну рутинную задачу на работе и реши её с ИИ на этой неделе\n2. Пройди мини-курс месяца\n3. Попробуй взять небольшой заказ в SYNAPSE Market, это первый доход сверху\n4. Приходи в четверг на эфир",
  "Начинаю с нуля": "Твой маршрут на месяц:\n1. Одна нейросеть на старте, не распыляйся\n2. 20 минут в день: каждый день понемногу лучше, чем раз в неделю по три часа\n3. Спрашивай всё у ИИ-помощника здесь, он объяснит простыми словами\n4. Сдай первое задание из «🎯 Задания»",
};

// ---------- GetCourse ----------
async function createDeal(u: U): Promise<{ ok: boolean; link?: string; error?: string }> {
  if (!GC_KEY) return { ok: false, error: "no_key" };
  const deal: any = { deal_status: "new", deal_comment: `SYNAPSE AI, Telegram ${u.username ? "@" + u.username : u.id}` };
  if (GC_OFFER) deal.offer_code = GC_OFFER; else { deal.product_title = "SYNAPSE AI: подписка на месяц"; deal.deal_cost = PRICE; deal.deal_currency = "RUB"; }
  const params = { user: { email: u.email, phone: u.phone, first_name: u.name || u.tgName }, system: { refresh_if_exists: 0, return_payment_link: 1, return_deal_number: 1 }, deal };
  const body = new URLSearchParams({ action: "add", key: GC_KEY, params: Buffer.from(JSON.stringify(params)).toString("base64") });
  try {
    const r = await fetch(`https://${GC_HOST}/pl/api/deals`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const txt = await r.text(); let j: any = null; try { j = JSON.parse(txt); } catch {}
    const res = j?.result;
    if (j?.success && res?.success && res?.payment_link) return { ok: true, link: res.payment_link };
    console.log("gc fail", r.status, txt.slice(0, 400));
    return { ok: false, error: String(res?.error_message || j?.error_message || "http " + r.status).slice(0, 200) };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

async function grant(u: U, days: number, source: string) {
  const was = active(u) && !ADMINS.has(u.id);
  const base = Math.max(Date.now(), u.paidUntil || 0);
  u.paidUntil = base + days * DAY; u.status = "active"; u.reminded = false; u.cancelled = false; save();
  db.subs.push({ ts: Date.now(), id: u.id, days, source }); save();
  if (!was) await onboard(u);
  else await send(u.id, `💙 Подписка продлена до ${fmtDate(u.paidUntil)}. Спасибо, что ты с нами!`);
}
async function links(): Promise<string> {
  const c = db.chats || {};
  const rows: string[] = [];
  if (c.channelLink) rows.push(`📢 Канал клуба: ${c.channelLink}`);
  if (c.chatLink) rows.push(`💬 Чат клуба: ${c.chatLink}`);
  return rows.length ? rows.join("\n") + "\nНажми на ссылку и отправь заявку, я одобрю её сама за пару секунд." : `Ссылки на канал и чат пришлю, как только их подключат. Если что, пиши ${MANAGER}`;
}
async function onboard(u: U) {
  await send(u.id, WELCOME, { reply_markup: MENU });
  await send(u.id, (await links()) + `\n\nПодписка активна до ${fmtDate(u.paidUntil)}.`);
  if (!u.anketa) await startAnketa(u);
}
async function kick(u: U) {
  for (const cid of [db.chats?.chat, db.chats?.channel].filter(Boolean)) {
    await api("banChatMember", { chat_id: cid, user_id: u.id, until_date: Math.floor(Date.now() / 1000) + 60 });
    await api("unbanChatMember", { chat_id: cid, user_id: u.id, only_if_banned: true });
  }
}

// ---------- anketa ----------
async function startAnketa(u: U) {
  u.step = "a_name"; u.draft = {}; save();
  await send(u.id, "📝 Давай познакомимся, это 6 коротких вопросов.\n\nКак тебя зовут?", { reply_markup: { remove_keyboard: true } });
}
async function anketaStep(u: U, text: string) {
  const d = u.draft || (u.draft = {});
  switch (u.step) {
    case "a_name": d.name = text.slice(0, 60); u.step = "a_role"; save();
      return send(u.id, "Кто ты сейчас?", { reply_markup: { keyboard: ROLES.map((r) => [{ text: r }]), resize_keyboard: true, one_time_keyboard: true } });
    case "a_role": d.role = ROLES.includes(text) ? text : text.slice(0, 60); u.step = "a_niche"; save();
      return send(u.id, "В какой нише работаешь или хочешь работать? Например: селлер одежды на WB, онлайн-школа, дизайн карточек", { reply_markup: { remove_keyboard: true } });
    case "a_niche": d.niche = text.slice(0, 200); u.step = "a_goal"; save();
      return send(u.id, "Чего хочешь добиться с ИИ в этом месяце? Одной фразой");
    case "a_goal": d.goal = text.slice(0, 300); u.step = "a_skills"; save();
      return send(u.id, "Чем можешь быть полезна или полезен другим участникам? Навыки, опыт, связи");
    case "a_skills": d.skills = text.slice(0, 300); u.step = "a_city"; save();
      return send(u.id, "Из какого ты города? Это для Random Coffee, вдруг найдётся пара рядом");
    case "a_city": {
      d.city = text.slice(0, 60); u.name = d.name; u.anketa = { ...d, ts: Date.now() }; u.step = ""; save();
      const first = !u.anketaRewarded; u.anketaRewarded = true; save();
      await send(u.id, `Спасибо, ${d.name}! 💙\n\n${ROUTES[d.role] || ROUTES["Начинаю с нуля"]}`, { reply_markup: MENU });
      if (first) addImp(u, 30, "анкета заполнена");
      if (db.chats?.chat) await send(u.id, "Опубликовать твою анкету в чате клуба, чтобы тебя узнали?", { reply_markup: { inline_keyboard: [[{ text: "Да, опубликуй", callback_data: "intro:yes" }, { text: "Не сейчас", callback_data: "intro:no" }]] } });
      return;
    }
  }
}
function card(u: U) {
  const a = u.anketa || {};
  return `${a.name || u.tgName}${u.username ? " (@" + u.username + ")" : ""}\n👤 ${a.role || "роль не указана"}\n💼 ${a.niche || ""}\n🎯 Цель: ${a.goal || ""}\n🤝 Чем полезен: ${a.skills || ""}\n📍 ${a.city || ""}`;
}

// ---------- schedule ----------
function upcoming(n = 10) { return db.events.filter((e: any) => e.at > Date.now() - 3600000).sort((a: any, b: any) => a.at - b.at).slice(0, n); }
function parseEvent(t: string) {
  const [dt, title, link] = t.split("|").map((s) => s.trim());
  const m = dt?.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (!m || !title) return null;
  const now = new Date();
  const y = m[3] ? Number(m[3]) : now.getUTCFullYear();
  const at = Date.UTC(y, Number(m[2]) - 1, Number(m[1]), Number(m[4]) - 3, Number(m[5]));
  return { id: Math.random().toString(36).slice(2, 9), at, title, link: link || "", r60: false, r0: false };
}
async function showSchedule(u: U) {
  const ev = upcoming();
  if (!ev.length) return send(u.id, "📅 Ближайших событий пока нет. Как только появятся, пришлю напоминание.");
  return send(u.id, "📅 Расписание клуба\n\n" + ev.map((e: any) => `${fmtDT(e.at)}\n${e.title}${e.link ? "\n" + e.link : ""}`).join("\n\n") + "\n\nЗа час до начала пришлю напоминание.");
}

// ---------- tasks ----------
async function showTasks(u: U) {
  const ts = db.tasks.slice(-5).reverse();
  if (!ts.length) return send(u.id, "🎯 Заданий пока нет. Первое придёт вместе с уроком мини-курса.");
  for (const t of ts) {
    const sub = (t.subs || []).find((s: any) => s.uid === u.id);
    const st = sub ? (sub.status === "ok" ? "✅ принято" : sub.status === "back" ? "↩️ на доработке" : "⏳ на проверке") : "не сдано";
    await send(u.id, `🎯 ${t.text}\n\nСтатус: ${st}`, sub?.status === "ok" ? {} : { reply_markup: { inline_keyboard: [[{ text: "📤 Сдать задание", callback_data: "sub:" + t.id }]] } });
  }
}
async function submit(u: U, taskId: string, m: any) {
  const t = db.tasks.find((x: any) => x.id === taskId);
  u.step = ""; save();
  if (!t) return send(u.id, "Не нашла это задание, загляни в «🎯 Задания» ещё раз.", { reply_markup: MENU });
  t.subs = (t.subs || []).filter((s: any) => s.uid !== u.id);
  const s = { id: Math.random().toString(36).slice(2, 9), uid: u.id, ts: Date.now(), status: "wait", text: m.text || m.caption || "" };
  t.subs.push(s); save();
  await send(u.id, "📤 Отправила на проверку куратору. Как только посмотрят, напишу 💙", { reply_markup: MENU });
  for (const a of ADMINS) {
    await send(a, `📥 Сдано задание\n«${t.text.slice(0, 120)}»\nот ${card(u).split("\n")[0]}`);
    await api("copyMessage", { chat_id: a, from_chat_id: u.id, message_id: m.message_id });
    await send(a, "Что делаем?", { reply_markup: { inline_keyboard: [[{ text: "✅ Принять, +50", callback_data: `ok:${t.id}:${s.id}` }, { text: "↩️ На доработку", callback_data: `back:${t.id}:${s.id}` }]] } });
  }
}

// ---------- random coffee ----------
async function pairCoffee() {
  const pool = members().filter((u) => u.coffee && u.anketa);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const groups: U[][] = [];
  for (let i = 0; i + 1 < pool.length; i += 2) groups.push([pool[i], pool[i + 1]]);
  if (pool.length % 2 === 1 && groups.length) groups[groups.length - 1].push(pool[pool.length - 1]);
  const week = new Date().toISOString().slice(0, 10);
  db.coffee.last = week; db.coffee.groups = groups.map((g) => g.map((u) => u.id)); save();
  for (const g of groups) for (const u of g) {
    const others = g.filter((x) => x.id !== u.id);
    await send(u.id, `☕ Random Coffee на эту неделю!\n\nТвоя пара:\n\n${others.map(card).join("\n\n")}\n\nНапиши первым и договоритесь на 20-30 минут. Расскажите друг другу, чем занимаетесь и чем можете помочь. Хорошие знакомства часто становятся заказами 😉`);
  }
  for (const u of pool.filter((x) => !groups.flat().includes(x))) await send(u.id, "☕ На этой неделе тебе не хватило пары, ты в приоритете на следующей 💙");
  return groups.length;
}
async function coffeeFollowup() {
  for (const g of db.coffee.groups || []) for (const id of g) await send(id, "☕ Как прошла встреча в Random Coffee?", { reply_markup: { inline_keyboard: [[{ text: "Встретились ✅", callback_data: "cf:yes" }, { text: "Не получилось", callback_data: "cf:no" }]] } });
}

// ---------- AI assistant ----------
const SYS = `Ты ИИ-помощник клуба SYNAPSE AI Ольги Пузановой. Участники клуба: собственники бизнеса и селлеры маркетплейсов, исполнители ИИ-услуг, сотрудники и новички. Ты помогаешь применять нейросети в работе: пишешь и улучшаешь промпты, разбираешь задачи по шагам, подсказываешь инструменты, помогаешь с текстами, контентом, таблицами, ботами и агентами.
Правила: отвечай по-русски, тепло и по делу, как опытный коллега. Коротко, со списками, где это помогает. Никогда не используй длинное тире. Если не знаешь точно, так и скажи. Не придумывай цены сервисов и факты. Если вопрос про оплату, доступ или подписку, отправь к менеджеру ${MANAGER}. Если задачу удобнее отдать исполнителю, предложи опубликовать её в SYNAPSE Market в чате клуба.`;
async function ask(u: U, text: string) {
  if (!AI_KEY) return send(u.id, "🤖 ИИ-помощник скоро заработает, его сейчас подключают. А пока задай вопрос в чате клуба 💙");
  const today = new Date().toISOString().slice(0, 10);
  if (u.aiDay !== today) { u.aiDay = today; u.aiCount = 0; }
  if (!ADMINS.has(u.id) && u.aiCount >= AI_DAILY) return send(u.id, `На сегодня лимит ${AI_DAILY} вопросов исчерпан, завтра продолжим 💙`);
  u.aiCount++; save();
  const hist = (u.hist || []).slice(-10);
  const msgs = [...hist, { role: "user", content: text.slice(0, 6000) }];
  await api("sendChatAction", { chat_id: u.id, action: "typing" });
  const a = u.anketa || {};
  const sys = SYS + (a.role ? `\nО собеседнике: ${a.name || ""}, ${a.role}, ниша: ${a.niche || "не указана"}, цель на месяц: ${a.goal || "не указана"}.` : "");
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: AI_MODEL, max_tokens: 1500, system: sys, messages: msgs }) });
    const j: any = await r.json();
    const out = (j?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    if (!out) { console.log("ai error", JSON.stringify(j).slice(0, 300)); return send(u.id, "Что-то пошло не так с ИИ, попробуй ещё раз через минуту."); }
    u.hist = [...msgs, { role: "assistant", content: out }].slice(-12); save();
    return send(u.id, out);
  } catch (e: any) { console.log("ai fail", e?.message); return send(u.id, "ИИ сейчас не отвечает, попробуй ещё раз через минуту."); }
}

// ---------- profile & subscription screens ----------
async function profile(u: U) {
  const l = level(u.impulses || 0);
  const done = db.tasks.reduce((n: number, t: any) => n + ((t.subs || []).some((s: any) => s.uid === u.id && s.status === "ok") ? 1 : 0), 0);
  return send(u.id, `👤 ${card(u)}\n\n⚡️ Импульсы: ${u.impulses || 0}\n🧠 Уровень: ${l.name}${l.next ? `, до «${l.next[1]}» ещё ${l.next[0] - (u.impulses || 0)}` : ""}\n🎯 Принятых заданий: ${done}\n☕ Random Coffee: ${u.coffee ? "участвую" : "на паузе"}\n💳 ${active(u) ? "Подписка до " + fmtDate(u.paidUntil) : "Подписка не активна"}`, { reply_markup: { inline_keyboard: [[{ text: "📝 Заполнить анкету заново", callback_data: "anketa" }], [{ text: "🏆 Топ участников", callback_data: "top" }]] } });
}
async function subscription(u: U) {
  if (active(u) && !ADMINS.has(u.id)) {
    return send(u.id, `💳 Подписка активна до ${fmtDate(u.paidUntil)}${u.cancelled ? ", автопродление отключено" : ", дальше продлится автоматически"}.\n\n${await links()}`, { reply_markup: { inline_keyboard: [[{ text: "Как отменить подписку", callback_data: "cancel" }]] } });
  }
  return send(u.id, `💳 SYNAPSE AI: ${PRICE.toLocaleString("ru-RU")} ₽ в месяц\n\n⚡️ фишка недели и готовые промпты\n🎓 мини-курс каждый месяц\n🎙 эфир с Олей каждый четверг\n💼 биржа заказов SYNAPSE Market\n☕ Random Coffee и импульсы\n🤖 ИИ-помощник прямо здесь\n\nСписание раз в месяц, отменить можно в любой момент.`, { reply_markup: { inline_keyboard: [[{ text: `Оформить за ${PRICE.toLocaleString("ru-RU")} ₽/мес`, callback_data: "buy" }]] } });
}

// ---------- update handlers ----------
async function onMessage(m: any) {
  if (m.chat.type !== "private") {
    if (ADMINS.has(m.from?.id) && /^\/topic(@\w+)?\s+intro/.test(m.text || "")) {
      db.chats.chat = db.chats.chat || m.chat.id; db.chats.introThread = m.message_thread_id || 0; save();
      await api("sendMessage", { chat_id: m.chat.id, message_thread_id: m.message_thread_id, text: "✅ Сюда буду публиковать анкеты новых участников" });
    }
    return;
  }
  const u = user(m.from); const t = String(m.text || "").trim(); const isAdm = ADMINS.has(u.id);
  if (t === "/start" || t.startsWith("/start ")) {
    u.step = ""; save();
    if (active(u)) { await send(u.id, `С возвращением${u.name ? ", " + u.name : ""}! 💙`, { reply_markup: MENU }); if (!u.anketa) await startAnketa(u); return; }
    await send(u.id, "Привет! Это бот клуба SYNAPSE AI Ольги Пузановой 💙\n\nЗдесь оформляется подписка, приходят расписание, задания и пары для Random Coffee, а ещё тут живёт ИИ-помощник для участников.", { reply_markup: MENU });
    return subscription(u);
  }
  if (t === "/admin" && isAdm) return send(u.id, "Панель клуба", { reply_markup: ADMIN_MENU });
  if (t === "/cancel" || t === "/stop") { u.step = ""; save(); return send(u.id, "Ок, вернулась в меню.", { reply_markup: MENU }); }
  const menu: Record<string, () => any> = {
    "📅 Расписание": () => showSchedule(u),
    "🎯 Задания": () => active(u) ? showTasks(u) : subscription(u),
    "🤖 ИИ-помощник": () => { if (!active(u)) return subscription(u); u.step = "ai"; save(); return send(u.id, "🤖 Я на связи! Пиши вопрос или задачу, помогу с промптом, текстом, таблицей или идеей. Чтобы выйти, нажми любую кнопку меню."); },
    "☕ Random Coffee": () => active(u) ? send(u.id, `☕ Random Coffee: каждый понедельник я подбираю тебе пару из клуба для знакомства на 20-30 минут.\n\nСейчас ты ${u.coffee ? "участвуешь" : "на паузе"}.${u.anketa ? "" : "\nЧтобы участвовать, нужна анкета."}`, { reply_markup: { inline_keyboard: [[{ text: u.coffee ? "Поставить на паузу" : "Участвовать", callback_data: "cf:toggle" }], ...(u.anketa ? [] : [[{ text: "📝 Заполнить анкету", callback_data: "anketa" }]])] } }) : subscription(u),
    "👤 Мой профиль": () => profile(u),
    "💳 Подписка": () => subscription(u),
  };
  if (menu[t]) { u.step = ""; save(); return menu[t](); }
  if (u.step?.startsWith("a_")) return anketaStep(u, t || "-");
  if (u.step === "email") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return send(u.id, "Кажется, в почте опечатка. Пришли ещё раз, пожалуйста");
    u.email = t.toLowerCase(); db.emails[u.email] = u.id; u.step = "phone"; save();
    return send(u.id, "Теперь телефон: нажми кнопку ниже или напиши номер", { reply_markup: { keyboard: [[{ text: "📱 Отправить номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  }
  if (u.step === "phone") {
    const ph = m.contact?.phone_number || t;
    if (String(ph).replace(/\D/g, "").length < 10) return send(u.id, "Пришли номер полностью, пожалуйста");
    u.phone = String(ph); u.step = ""; save();
    return pay(u);
  }
  if (u.step?.startsWith("sub:")) return submit(u, u.step.slice(4), m);
  if (isAdm && u.step?.startsWith("adm_")) return adminStep(u, t, m);
  if (u.step === "ai" && t) return ask(u, t);
  if (t && active(u)) return send(u.id, "Выбери, что нужно, в меню ниже 👇 Если хочешь спросить ИИ, нажми «🤖 ИИ-помощник».", { reply_markup: MENU });
  if (t) return subscription(u);
}
async function pay(u: U) {
  await send(u.id, "Секунду, готовлю ссылку на оплату…", { reply_markup: MENU });
  const r = await createDeal(u);
  if (!r.ok) { console.log("pay error", r.error); return send(u.id, `Не получилось создать оплату автоматически. Напиши, пожалуйста, ${MANAGER}, тебе помогут за пару минут 💙`); }
  return send(u.id, `Готово! Оплата по кнопке ниже. Как только платёж пройдёт, я пришлю доступ в клуб.\n\nПодписка продлевается раз в месяц автоматически, отменить можно в любой момент.`, { reply_markup: { inline_keyboard: [[{ text: `💳 Оплатить ${PRICE.toLocaleString("ru-RU")} ₽`, url: r.link }]] } });
}
async function adminStep(u: U, t: string, m: any) {
  const step = u.step; u.step = ""; save();
  if (step === "adm_event") {
    const e = parseEvent(t);
    if (!e) { u.step = "adm_event"; save(); return send(u.id, "Не разобрала. Формат: 06.11 19:00 | Эфир ответов | ссылка"); }
    db.events.push(e); save();
    await send(u.id, `✅ Добавила: ${fmtDT(e.at)}, ${e.title}. Участникам напомню за час.`);
    for (const x of members()) await send(x.id, `📅 Новое в расписании клуба\n${fmtDT(e.at)}\n${e.title}${e.link ? "\n" + e.link : ""}`);
    return;
  }
  if (step === "adm_task") {
    if (!t) { u.step = "adm_task"; save(); return send(u.id, "Пришли текст задания одним сообщением"); }
    const task = { id: Math.random().toString(36).slice(2, 9), ts: Date.now(), text: t, subs: [] }; db.tasks.push(task); save();
    let n = 0; for (const x of members()) { await send(x.id, `🎯 Новое задание\n\n${t}\n\nЗа принятое задание +50 импульсов.`, { reply_markup: { inline_keyboard: [[{ text: "📤 Сдать задание", callback_data: "sub:" + task.id }]] } }); n++; }
    return send(u.id, `✅ Отправила задание ${n} участникам`);
  }
  if (step === "adm_broadcast") {
    let n = 0; for (const x of members()) { const r = await api("copyMessage", { chat_id: x.id, from_chat_id: u.id, message_id: m.message_id }); if (r?.ok) n++; }
    return send(u.id, `✅ Рассылка ушла ${n} участникам`);
  }
  if (step === "adm_grant") {
    const [who, d] = t.split(/\s+/); const days = Number(d || 31);
    const target = (Object.values(db.users) as U[]).find((x) => who && ((x.email && x.email === who.toLowerCase()) || (x.username && "@" + x.username.toLowerCase() === who.toLowerCase()) || String(x.id) === who));
    if (!target) { if (who?.includes("@") && who.includes(".")) { db.pending = db.pending || {}; db.pending[who.toLowerCase()] = days; save(); return send(u.id, `Этот человек ещё не заходил в бота. Как только он оформит заявку с почтой ${who}, доступ на ${days} дней включится сам.`); } return send(u.id, "Не нашла такого участника. Пришли почту, @username или id и число дней, например: anna@mail.ru 31"); }
    await grant(target, days, "manual by admin"); return send(u.id, `✅ Доступ выдан до ${fmtDate(target.paidUntil)}`);
  }
  if (step?.startsWith("adm_back:")) {
    const [, tid, sid] = step.split(":"); const tk = db.tasks.find((x: any) => x.id === tid); const s = tk?.subs?.find((x: any) => x.id === sid);
    if (s) { s.status = "back"; s.comment = t; save(); await send(s.uid, `↩️ Куратор вернул задание на доработку:\n\n${t}\n\nПоправь и сдай ещё раз в «🎯 Задания» 💙`); }
    return send(u.id, "✅ Комментарий отправлен");
  }
}
async function onCallback(q: any) {
  const u = user(q.from); const d = String(q.data || ""); const isAdm = ADMINS.has(u.id);
  await api("answerCallbackQuery", { callback_query_id: q.id });
  if (d === "buy") {
    if (!u.email) { u.step = "email"; save(); return send(u.id, "Чтобы оформить подписку, пришли свою почту. На неё придёт чек, и по ней я узнаю твою оплату"); }
    if (!u.phone) { u.step = "phone"; save(); return send(u.id, "Пришли телефон, нажми кнопку ниже", { reply_markup: { keyboard: [[{ text: "📱 Отправить номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }); }
    return pay(u);
  }
  if (d === "cancel") { u.cancelled = true; save(); return send(u.id, `Жаль, но я понимаю 💙\n\nАвтопродление отключается в личном кабинете ${GC_HOST}: раздел с покупками и подписками. Если не получится, напиши ${MANAGER}, отключат вручную.\n\nДоступ в клуб останется до ${fmtDate(u.paidUntil)}.`); }
  if (d === "anketa") return startAnketa(u);
  if (d === "top") {
    const top = (Object.values(db.users) as U[]).filter((x) => x.impulses && !ADMINS.has(x.id)).sort((a, b) => b.impulses - a.impulses).slice(0, 10);
    return send(u.id, top.length ? "🏆 Топ участников по импульсам\n\n" + top.map((x, i) => `${i + 1}. ${x.name || x.tgName} · ${x.impulses} · ${level(x.impulses).name}`).join("\n") : "Пока никто не набрал импульсов, ты можешь стать первым 😉");
  }
  if (d.startsWith("intro:")) {
    if (d === "intro:yes" && db.chats?.chat) { await api("sendMessage", { chat_id: db.chats.chat, message_thread_id: db.chats.introThread || undefined, text: "👋 В клубе новый участник!\n\n" + card(u) }); return send(u.id, "Опубликовала 💙"); }
    return send(u.id, "Хорошо, можно сделать позже в «👤 Мой профиль».");
  }
  if (d.startsWith("sub:")) { if (!active(u)) return subscription(u); u.step = d; save(); return send(u.id, "📤 Пришли ответ одним сообщением: текст, скрин, файл или ссылку. Передумала: /cancel"); }
  if (d === "cf:toggle") { u.coffee = !u.coffee; save(); return send(u.id, u.coffee ? "☕ Ты в Random Coffee! Пару пришлю в понедельник" : "☕ Поставила на паузу. Вернуться можно в любой момент"); }
  if (d === "cf:yes") { const wk = db.coffee.last; if (u.coffeeRewarded !== wk) { u.coffeeRewarded = wk; addImp(u, 20, "встреча в Random Coffee"); } return; }
  if (d === "cf:no") return send(u.id, "Бывает! На следующей неделе подберу новую пару 💙");
  if (d.startsWith("bind:") && isAdm) {
    const [, kind, cid] = d.split(":"); const id = Number(cid);
    const r = await api("createChatInviteLink", { chat_id: id, name: "SYNAPSE AI", creates_join_request: true });
    if (!r?.ok) return send(u.id, "Не получилось создать ссылку: " + (r?.description || "") + ". Проверь, что у бота есть право приглашать участников.");
    if (kind === "channel") { db.chats.channel = id; db.chats.channelLink = r.result.invite_link; } else { db.chats.chat = id; db.chats.chatLink = r.result.invite_link; }
    save(); return send(u.id, `✅ ${kind === "channel" ? "Канал" : "Чат"} подключён. Ссылка для участников: ${r.result.invite_link}\nПо ней можно попасть только с активной подпиской, остальным я откажу.${kind === "chat" ? "\n\nЧтобы анкеты публиковались в нужный топик, напиши в этом топике команду /topic intro" : ""}`);
  }
  if (!isAdm) return;
  if (d === "adm:event") { u.step = "adm_event"; save(); return send(u.id, "Пришли событие в формате:\n06.11 19:00 | Эфир ответов | ссылка\n\nСсылку можно не писать. Время московское."); }
  if (d === "adm:task") { u.step = "adm_task"; save(); return send(u.id, "Пришли текст задания одним сообщением. Его получат все участники с активной подпиской."); }
  if (d === "adm:broadcast") { u.step = "adm_broadcast"; save(); return send(u.id, "Пришли сообщение для рассылки: текст, фото или видео. Его получат все участники с активной подпиской."); }
  if (d === "adm:grant") { u.step = "adm_grant"; save(); return send(u.id, "Кому выдать доступ? Почта, @username или id и число дней.\nНапример: anna@mail.ru 31\n\nТак можно включить клуб тем, кто купил лот на дне рождения."); }
  if (d === "adm:coffee") { const n = await pairCoffee(); return send(u.id, `☕ Собрала ${n} пар`); }
  if (d === "adm:stats") {
    const all = Object.values(db.users) as U[]; const act = members();
    return send(u.id, `📊 Клуб сейчас\n\nАктивных подписок: ${act.length}\nОтключили автопродление: ${act.filter((x) => x.cancelled).length}\nЗаходили в бота всего: ${all.length}\nАнкет: ${act.filter((x) => x.anketa).length}\nВ Random Coffee: ${act.filter((x) => x.coffee && x.anketa).length}\nЗаданий: ${db.tasks.length}, ждут проверки: ${db.tasks.reduce((n: number, t: any) => n + (t.subs || []).filter((s: any) => s.status === "wait").length, 0)}\nСобытий впереди: ${upcoming(100).length}\nКанал: ${db.chats.channel ? "подключён" : "нет"}, чат: ${db.chats.chat ? "подключён" : "нет"}\nОплата GetCourse: ${GC_KEY ? "ключ есть" : "ключа нет"}${GC_OFFER ? ", предложение " + GC_OFFER : ""}\nИИ-помощник: ${AI_KEY ? "подключён" : "ключа нет"}`);
  }
  if (d.startsWith("ok:") || d.startsWith("back:")) {
    const [act, tid, sid] = d.split(":"); const tk = db.tasks.find((x: any) => x.id === tid); const s = tk?.subs?.find((x: any) => x.id === sid);
    if (!s) return send(u.id, "Не нашла эту сдачу");
    if (act === "ok") { if (s.status !== "ok") { s.status = "ok"; save(); const mu = db.users[String(s.uid)]; await send(s.uid, `✅ Задание принято!\n«${tk.text.slice(0, 100)}»`); if (mu) addImp(mu, 50, "задание принято"); } if (q.message) await api("editMessageReplyMarkup", { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: "✅ Принято", callback_data: "noop" }]] } }); return; }
    u.step = `adm_back:${tid}:${sid}`; save(); return send(u.id, "Напиши комментарий, что доработать. Он уйдёт участнику.");
  }
}
async function onMyChatMember(x: any) {
  const c = x.chat; const st = x.new_chat_member?.status;
  if (c.type === "private" || st !== "administrator") return;
  for (const a of ADMINS) {
    if (a !== OWNER_ID) continue;
    await send(a, `Меня сделали админом в «${c.title}». Это канал или чат клуба?`, { reply_markup: { inline_keyboard: [[{ text: "📢 Канал клуба", callback_data: `bind:channel:${c.id}` }, { text: "💬 Чат клуба", callback_data: `bind:chat:${c.id}` }]] } });
  }
}
async function onJoinRequest(r: any) {
  const u = user(r.from);
  if (active(u)) return api("approveChatJoinRequest", { chat_id: r.chat.id, user_id: u.id });
  await api("declineChatJoinRequest", { chat_id: r.chat.id, user_id: u.id });
  await send(u.id, "Вход в клуб открывается после оформления подписки 💙");
  return subscription(u);
}

// ---------- GetCourse webhook ----------
async function onGc(params: URLSearchParams) {
  const email = String(params.get("email") || "").trim().toLowerCase();
  const deal = String(params.get("deal") || params.get("number") || "");
  const status = String(params.get("status") || "").toLowerCase();
  const days = Number(params.get("days") || 31);
  if (!email) return { ok: false, error: "no email" };
  const id = db.emails[email];
  const u = id ? db.users[String(id)] : null;
  if (/отмен|cancel/.test(status)) { if (u) { u.cancelled = true; save(); } return { ok: true, cancelled: !!u }; }
  if (deal && db.deals[deal]) return { ok: true, duplicate: true };
  if (deal) { db.deals[deal] = Date.now(); save(); }
  if (!u) { db.pending = db.pending || {}; db.pending[email] = (db.pending[email] || 0) + days; save(); return { ok: true, pending: true }; }
  await grant(u, days, "getcourse " + deal);
  return { ok: true, until: u.paidUntil };
}

// ---------- timers ----------
let lastTick = 0;
async function tick() {
  if (Date.now() - lastTick < 50000) return; lastTick = Date.now();
  const now = Date.now();
  // pending grants from GetCourse or admin before the person opened the bot
  for (const [email, days] of Object.entries(db.pending || {})) { const id = db.emails[email]; if (id && db.users[String(id)]) { delete db.pending[email]; save(); await grant(db.users[String(id)], Number(days), "pending"); } }
  // event reminders
  for (const e of db.events) {
    if (!e.r60 && e.at - now <= 3600000 && e.at - now > 0) { e.r60 = true; save(); for (const x of members()) await send(x.id, `⏰ Через час: ${e.title}\n${fmtDT(e.at)}${e.link ? "\n" + e.link : ""}`); }
    if (!e.r0 && e.at <= now && now - e.at < 600000) { e.r0 = true; save(); for (const x of members()) await send(x.id, `🔴 Начинаем: ${e.title}${e.link ? "\n" + e.link : ""}`); }
  }
  // renewal reminders and expiry
  for (const u of Object.values(db.users) as U[]) {
    if (ADMINS.has(u.id) || !u.paidUntil) continue;
    if (u.status === "active" && !u.reminded && u.paidUntil - now < 3 * DAY && u.paidUntil > now) {
      u.reminded = true; save();
      const done = db.tasks.reduce((n: number, t: any) => n + ((t.subs || []).some((s: any) => s.uid === u.id && s.status === "ok") ? 1 : 0), 0);
      await send(u.id, `💙 Через 3 дня, ${fmtDate(u.paidUntil)}, ${u.cancelled ? "закончится твой доступ в клуб" : "подписка продлится автоматически"}.\n\nЗа это время у тебя: ⚡️ ${u.impulses || 0} импульсов, уровень «${level(u.impulses || 0).name}», принятых заданий ${done}. Впереди новый мини-курс и эфиры, оставайся с нами!`);
    }
    if (u.status === "active" && u.paidUntil + GRACE_MS < now) {
      u.status = "expired"; save(); await kick(u);
      await send(u.id, "Подписка на SYNAPSE AI не продлилась, поэтому я закрыла доступ в канал и чат. Твои импульсы и анкета сохранены, вернуться можно в любой момент 💙", { reply_markup: { inline_keyboard: [[{ text: "Вернуться в клуб", callback_data: "buy" }]] } });
    }
  }
  // random coffee: Monday 11:00 pairs, Friday 12:00 follow-up (Moscow time)
  const msk = new Date(now + 3 * 3600000); const dow = msk.getUTCDay(); const hm = msk.getUTCHours() * 60 + msk.getUTCMinutes(); const dayKey = msk.toISOString().slice(0, 10);
  if (dow === 1 && hm >= 660 && db.coffee.pairedDay !== dayKey) { db.coffee.pairedDay = dayKey; save(); await pairCoffee(); }
  if (dow === 5 && hm >= 720 && db.coffee.followDay !== dayKey) { db.coffee.followDay = dayKey; save(); await coffeeFollowup(); }
}
setInterval(() => { tick().catch((e) => console.log("tick error", e?.message)); }, 60000);

// ---------- setup ----------
let STATUS = "нет токена";
async function setup() {
  if (!TG || !PUBLIC) { STATUS = !TG ? "нет TG_TOKEN" : "нет PUBLIC_URL"; return; }
  const r = await api("setWebhook", { url: `${PUBLIC}/tg/${KEY}`, secret_token: KEY, allowed_updates: ["message", "callback_query", "my_chat_member", "chat_join_request"] });
  await api("setMyCommands", { commands: [{ command: "start", description: "Главное меню" }, { command: "cancel", description: "Выйти из режима" }] });
  STATUS = r?.ok ? "webhook ok" : "webhook error: " + r?.description;
  console.log("setup", STATUS);
}

Bun.serve({
  port: Number(Bun.env.PORT || 3000),
  async fetch(req) {
    const url = new URL(req.url);
    tick().catch(() => {});
    if (req.method === "POST" && url.pathname === "/tg/" + KEY) {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== KEY) return new Response("forbidden", { status: 403 });
      try {
        const u = JSON.parse(await req.text());
        if (u.message) await onMessage(u.message);
        else if (u.callback_query) await onCallback(u.callback_query);
        else if (u.my_chat_member) await onMyChatMember(u.my_chat_member);
        else if (u.chat_join_request) await onJoinRequest(u.chat_join_request);
      } catch (e: any) { console.log("update error", e?.message, e?.stack?.split("\n")[1]); }
      return new Response("ok");
    }
    if (url.pathname === "/gc/" + KEY) {
      const p = new URLSearchParams(url.search);
      if (req.method === "POST") { try { const txt = await req.text(); const ct = req.headers.get("content-type") || ""; if (ct.includes("json")) { const j = JSON.parse(txt); for (const [k, v] of Object.entries(j)) p.set(k, String(v)); } else new URLSearchParams(txt).forEach((v, k) => p.set(k, v)); } catch {} }
      return Response.json(await onGc(p));
    }
    if (url.pathname === "/health") return Response.json({ ok: true, status: STATUS, users: Object.keys(db.users).length, members: members().length });
    return new Response("SYNAPSE AI bot", { status: 200 });
  },
});
await setup();
console.log("synapse bot up", STATUS, "| getcourse", GC_KEY ? "key" : "no key", "| ai", AI_KEY ? "key" : "no key");
