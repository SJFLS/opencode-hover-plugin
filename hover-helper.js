// opencode-hover 助手：连 CDP，注入 inject.js，按需从 opencode.db 取用户消息，
// 通过共享 DOM 属性回填渲染进程（避开 Electron 多 world 的 window 隔离）。
// 运行：bun hover-helper.js   （需要 OpenCode 以 --remote-debugging-port=9222 启动）
import { Database } from "bun:sqlite";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { homedir } from "node:os";

const PORT = Number(process.env.OPENCODE_HOVER_PORT || 9222);
const __dir = dirname(fileURLToPath(import.meta.url));
const INJECT = readFileSync(join(__dir, "inject.js"), "utf8");

// 跨平台定位 opencode.db。OpenCode 用 xdg-basedir：data 目录 = $XDG_DATA_HOME/opencode，
// 未设则回退 ~/.local/share/opencode（macOS / Linux / Windows 一致，不用 %APPDATA%）。
// db 文件名按安装渠道不同：正式版 opencode.db，其他渠道 opencode-<channel>.db；
// 还可被 OPENCODE_DB 覆盖。这里优先级：OPENCODE_DB > 自动挑选存在且最新的 db 文件。
function resolveDbPath() {
  // 1) 显式覆盖
  if (process.env.OPENCODE_DB) {
    const v = process.env.OPENCODE_DB;
    if (v === ":memory:") return v;
    if (isAbsolute(v)) return v;
    return join(dataDir(), v);
  }
  // 2) 在 data 目录里找存在的 db 文件
  const dir = dataDir();
  const exact = join(dir, "opencode.db");
  if (existsSync(exact)) return exact;
  // 渠道版：opencode-<channel>.db，挑最近修改的那个
  try {
    const cands = readdirSync(dir)
      .filter((f) => /^opencode.*\.db$/.test(f))
      .map((f) => join(dir, f))
      .filter((p) => existsSync(p))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (cands.length) return cands[0];
  } catch {}
  return exact; // 都没有也返回默认路径，让 Database 抛清晰错误
}

function dataDir() {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), ".local", "share");
  return join(base, "opencode");
}

const DB_PATH = resolveDbPath();
console.log("[helper] db:", DB_PATH);
const db = new Database(DB_PATH, { readonly: true });
const stmt = db.query(`
  SELECT m.id AS id,
    (SELECT group_concat(json_extract(p.data,'$.text'), char(10))
       FROM part p
      WHERE p.message_id = m.id
        AND json_extract(p.data,'$.type') = 'text'
        AND IFNULL(json_extract(p.data,'$.synthetic'),0) = 0
        AND IFNULL(json_extract(p.data,'$.ignored'),0) = 0) AS text
  FROM message m
  WHERE m.session_id = $sid AND json_extract(m.data,'$.role') = 'user'
  ORDER BY m.time_created, m.id
`);

function getMessages(sid) {
  try {
    return stmt.all({ $sid: sid })
      .map((r) => ({ id: r.id, text: (r.text || "").trim() }))
      .filter((r) => r.text.length > 0)
      .map((r) => ({ id: r.id, text: r.text.length > 200 ? r.text.slice(0, 200) + "…" : r.text }));
  } catch (e) {
    console.error("[helper] db error:", e?.message || e);
    return [];
  }
}

const b64utf8 = (s) => Buffer.from(s, "utf8").toString("base64");
const connected = new Set();

function attach(target) {
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl || connected.has(target.id)) return;
  connected.add(target.id);

  const ws = new WebSocket(wsUrl);
  let idc = 0;
  let topFrame = null;
  let mainCtx = null;
  const injectedCtx = new Set();
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++idc, method, params }));

  function tryInject() {
    if (mainCtx != null && !injectedCtx.has(mainCtx)) {
      injectedCtx.add(mainCtx);
      send("Runtime.evaluate", { expression: INJECT, contextId: mainCtx }); // 钉住主上下文注入
    }
  }

  ws.addEventListener("open", () => {
    send("Runtime.enable");
    send("Page.enable");
    send("Runtime.addBinding", { name: "__opencodeHoverBinding" });
    send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT }); // 整页重载自动注入
    send("Page.getFrameTree");
    console.log("[helper] attached:", target.url || target.id);
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    // 取顶层 frame
    if (msg.id && msg.result?.frameTree?.frame && !topFrame) {
      topFrame = msg.result.frameTree.frame.id;
    }

    if (msg.method === "Runtime.executionContextCreated") {
      const c = msg.params.context;
      if (c.auxData?.isDefault === true && (!topFrame || c.auxData.frameId === topFrame)) {
        mainCtx = c.id;
        tryInject();
      }
    } else if (msg.method === "Runtime.executionContextDestroyed") {
      if (msg.params.executionContextId === mainCtx) mainCtx = null;
    } else if (msg.method === "Runtime.executionContextsCleared") {
      mainCtx = null;
      injectedCtx.clear();
    } else if (msg.method === "Runtime.bindingCalled" && msg.params?.name === "__opencodeHoverBinding") {
      let payload;
      try { payload = JSON.parse(msg.params.payload); } catch { return; }
      const data = getMessages(payload.sessionId);
      const attr = "data-ophv-r" + payload.reqId;
      const expr = `document.documentElement.setAttribute(${JSON.stringify(attr)}, ${JSON.stringify(b64utf8(JSON.stringify(data)))})`;
      // 写入共享 DOM，目标用调用方所在 world（刚调用过，必定存活）
      send("Runtime.evaluate", { expression: expr, contextId: msg.params.executionContextId });
    }
  });

  ws.addEventListener("close", () => { connected.delete(target.id); });
  ws.addEventListener("error", () => { connected.delete(target.id); });
}

async function loop() {
  console.log("[helper] 监听 OpenCode 窗口 (CDP :" + PORT + ") …");
  let seenPort = false; // 是否成功探到过端口（即 OpenCode 起来过）
  let misses = 0;       // 探不到端口的连续次数
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      seenPort = true;
      misses = 0;
      for (const t of targets) if (t.type === "page") attach(t);
    } catch {
      // 端口探不到：起步阶段(还没起来)就继续等；已经起来过则视为 OpenCode 退出
      if (seenPort && ++misses >= 3) {
        console.log("[helper] OpenCode 已退出，注入助手自动停止。");
        process.exit(0);
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

loop();
