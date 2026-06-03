/* opencode-hover: 注入官方桌面版渲染进程
   hover 左侧会话项 -> 浮层列出该会话里我发过的消息 -> 点击跳到该会话并滚动定位
   说明：Electron contextIsolation 下多 world 共享同一 DOM 但 window 各自独立，
   因此安装锁与数据回填都走「共享 DOM」，避免 world 不匹配。 */
(() => {
  var ROOT = document.documentElement;
  if (ROOT.getAttribute('data-ophv-installed') === '1') return;   // 跨 world 唯一安装
  ROOT.setAttribute('data-ophv-installed', '1');

  // ---- 数据：请求走 CDP binding，响应由助手写到 DOM 属性 data-ophv-r<reqId> ----
  var reqSeq = 0;
  function decodeB64Utf8(b64) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); })); }
    catch (e) { return '[]'; }
  }
  function fetchMessages(sessionId) {
    return new Promise(function (resolve) {
      var reqId = String(++reqSeq) + '_' + Date.now();
      var attr = 'data-ophv-r' + reqId;
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var v = ROOT.getAttribute(attr);
        if (v !== null) {
          clearInterval(iv);
          ROOT.removeAttribute(attr);
          try { resolve(JSON.parse(decodeB64Utf8(v))); } catch (e) { resolve([]); }
        } else if (tries > 80) { clearInterval(iv); resolve([]); }
      }, 50);
      try { window.__opencodeHoverBinding(JSON.stringify({ reqId: reqId, sessionId: sessionId })); }
      catch (e) { clearInterval(iv); resolve([]); }
    });
  }

  // ---- 主题：读 OpenCode 自身的 <html data-color-scheme="dark|light">，
  //      而非系统 prefers-color-scheme（二者可能不一致）。切换时实时跟随。----
  function applyTheme() {
    // 官方把深/浅标记在 <html data-color-scheme>，没有则回退到系统外观
    var scheme = ROOT.getAttribute('data-color-scheme');
    if (scheme !== 'dark' && scheme !== 'light') {
      scheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    ROOT.setAttribute('data-ophv-scheme', scheme);
  }
  applyTheme();
  // 监听官方主题切换（data-theme / data-color-scheme 变化）
  try {
    new MutationObserver(applyTheme).observe(ROOT, {
      attributes: true,
      attributeFilter: ['data-color-scheme', 'data-theme']
    });
  } catch (e) {}

  // ---- 样式（按 :root[data-ophv-scheme] 切换深/浅变量）----
  var style = document.createElement('style');
  style.textContent =
    // 深色变量（默认）
    ':root[data-ophv-scheme="dark"] .ophv-card{--ophv-bg:#1f1f22;--ophv-fg:#e7e7ea;--ophv-muted:#9a9aa0;' +
    '--ophv-border:rgba(255,255,255,.14);--ophv-sep:rgba(255,255,255,.06);' +
    '--ophv-hover:rgba(255,255,255,.08);--ophv-shadow:0 12px 40px rgba(0,0,0,.6);}' +
    // 浅色变量
    ':root[data-ophv-scheme="light"] .ophv-card{--ophv-bg:#ffffff;--ophv-fg:#1d1d1f;--ophv-muted:#6e6e73;' +
    '--ophv-border:rgba(0,0,0,.12);--ophv-sep:rgba(0,0,0,.07);' +
    '--ophv-hover:rgba(0,0,0,.06);--ophv-shadow:0 12px 40px rgba(0,0,0,.18);}' +
    // 兜底（属性未就绪时按深色）
    '.ophv-card{--ophv-bg:#1f1f22;--ophv-fg:#e7e7ea;--ophv-muted:#9a9aa0;' +
    '--ophv-border:rgba(255,255,255,.14);--ophv-sep:rgba(255,255,255,.06);' +
    '--ophv-hover:rgba(255,255,255,.08);--ophv-shadow:0 12px 40px rgba(0,0,0,.6);' +
    'position:fixed;z-index:2147483647;max-width:520px;min-width:340px;max-height:70vh;overflow-y:auto;' +
    'background:var(--ophv-bg);color:var(--ophv-fg);border:1px solid var(--ophv-border);border-radius:12px;padding:6px;' +
    'box-shadow:var(--ophv-shadow);font-size:13.5px;line-height:1.55;' +
    'font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;}' +
    '.ophv-title{padding:7px 12px 9px;color:var(--ophv-muted);font-size:11.5px;position:sticky;top:0;background:var(--ophv-bg);}' +
    '.ophv-item{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;' +
    'width:100%;text-align:left;padding:10px 12px;border:0;background:transparent;color:var(--ophv-fg);' +
    'cursor:pointer;white-space:normal;word-break:break-word;font:inherit;}' +
    '.ophv-item + .ophv-item{border-top:1px solid var(--ophv-sep);}' +
    '.ophv-item:hover{background:var(--ophv-hover);border-radius:7px;}' +
    '.ophv-empty{padding:10px 12px;color:var(--ophv-muted);}';
  ROOT.appendChild(style);

  var card = null, hideTimer = null, overTrigger = false, overCard = false, curSession = null;
  var showTimer = null, pendingSid = null;
  var triggerElCur = null;            // 当前浮窗对应的触发会话项（用于坐标兜底命中）
  var lastPt = { x: -1, y: -1 };      // 最近一次鼠标坐标
  var HIDE_GAP = 8;                   // 触发项与卡片之间留的容差，避免缝隙处误隐藏
  var SHOW_DELAY = 500;

  function removeCard() {
    if (card) { card.remove(); card = null; }
    curSession = null; triggerElCur = null; overTrigger = false; overCard = false;
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      // 收起前再用坐标复检一次：不在卡片/触发项/过渡区内才真正移除。
      if (overTrigger || overCard) return;
      if (inBridgeZone(lastPt.x, lastPt.y)) return;
      removeCard();
    }, 220);
  }
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\]]/g, '\\$&'); }

  function rectOf(el) {
    if (!el || !el.isConnected) return null;
    var r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return r;
  }
  function ptInRect(r, x, y, pad) {
    if (!r) return false;
    pad = pad || 0;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }
  function ptInEl(el, x, y, pad) { return ptInRect(rectOf(el), x, y, pad); }

  // 触发项与卡片的「联合包围盒」（含容差）。鼠标从触发项斜向移到卡片时，
  // 中途会经过两矩形之间的对角空隙——只要还在这个包围盒内就不收起，避免误隐藏。
  function inBridgeZone(x, y) {
    var rt = rectOf(triggerElCur), rc = rectOf(card);
    if (!rt && !rc) return false;
    var box = rt && rc ? {
      left: Math.min(rt.left, rc.left), right: Math.max(rt.right, rc.right),
      top: Math.min(rt.top, rc.top), bottom: Math.max(rt.bottom, rc.bottom),
    } : (rt || rc);
    return ptInRect(box, x, y, HIDE_GAP);
  }

  // 兜底：用最近鼠标坐标判断是否还在「卡片 / 触发项 / 二者之间的过渡区」内。
  // 在过渡区内 -> 保留（不立即隐藏）；完全离开 -> 走宽限延迟隐藏。
  // 这样既修了「事件丢失导致不消失」，又不会在斜穿空隙时误收起。
  function recheckPointer() {
    if (!card) return;
    var onCard = ptInEl(card, lastPt.x, lastPt.y, 0);
    var onTrig = ptInEl(triggerElCur, lastPt.x, lastPt.y, HIDE_GAP);
    overCard = onCard; overTrigger = onTrig;
    if (onCard || onTrig) { clearTimeout(hideTimer); return; }
    if (inBridgeZone(lastPt.x, lastPt.y)) return;  // 在过渡区，保持现状（不收起也不强留计时）
    scheduleHide();                                 // 真正离开，宽限后由 scheduleHide 收起
  }

  function position(el, triggerEl) {
    var r = triggerEl.getBoundingClientRect();
    var w = el.offsetWidth || 280, h = el.offsetHeight || 120;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = r.right + 8;
    if (left + w > vw - 8) left = Math.max(8, r.left - w - 8);
    var top = r.top;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function render(el, sessionId, msgs) {
    el.innerHTML = '';
    var title = document.createElement('div');
    title.className = 'ophv-title';
    title.textContent = msgs.length ? ('我发送的消息 (' + msgs.length + ')') : '没有消息';
    el.appendChild(title);
    if (!msgs.length) {
      var e = document.createElement('div');
      e.className = 'ophv-empty';
      e.textContent = '这个会话还没有用户消息';
      el.appendChild(e);
      return;
    }
    msgs.forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'ophv-item';
      b.textContent = m.text || '(无文本)';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); jumpTo(sessionId, m.id); });
      el.appendChild(b);
    });
  }

  function showCard(triggerEl, sessionId) {
    if (curSession === sessionId && card) return;
    removeCard();
    curSession = sessionId;
    triggerElCur = triggerEl;
    card = document.createElement('div');
    card.className = 'ophv-card';
    card.innerHTML = '<div class="ophv-title">加载中…</div>';
    card.addEventListener('mouseenter', function () {
      overCard = true; clearTimeout(hideTimer);
      clearTimeout(showTimer); showTimer = null; pendingSid = null; // 进入浮窗即取消任何待切换，避免斜穿 B 行被切走
    });
    card.addEventListener('mouseleave', function () { overCard = false; scheduleHide(); });
    document.body.appendChild(card);
    position(card, triggerEl);
    fetchMessages(sessionId).then(function (msgs) {
      if (curSession !== sessionId || !card) return;
      render(card, sessionId, msgs);
      position(card, triggerEl);
    });
  }

  function findMsgEl(messageId) {
    return document.getElementById('message-' + messageId) ||
      document.querySelector('[data-message-id="' + cssEscape(messageId) + '"]');
  }

  function jumpTo(sessionId, messageId) {
    // 不关闭浮窗：点击后跳转，浮窗保留（鼠标仍在其上时不会收起，可连续点多条）
    // 通过「会话路由 + #message-<id> hash」导航，触发官方 useSessionHashScroll 的 reveal+滚动
    var row = document.querySelector('[data-session-id="' + cssEscape(sessionId) + '"]');
    var link = row ? row.querySelector('a[href*="/session/"]') : null;
    var base = link ? link.getAttribute('href') : null;
    var hash = '#message-' + messageId;
    if (base) {
      var full = base.split('#')[0] + hash;
      var a = document.createElement('a');
      a.href = full;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();                       // 交给 solid-router 客户端导航（含 hash）
      setTimeout(function () { a.remove(); }, 0);
    } else {
      try { location.hash = hash; } catch (e) {}
    }
    // 兜底高亮：官方 reveal 后目标元素会出现，找到就高亮（必要时再滚一次）
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var el = findMsgEl(messageId);
      if (el) {
        clearInterval(iv);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (tries > 60) { clearInterval(iv); }
    }, 100);
  }

  document.addEventListener('mouseover', function (e) {
    if (!(e.target instanceof Element)) return;
    var t = e.target.closest('[data-session-id]');
    if (!t) return;
    var sid = t.getAttribute('data-session-id');
    if (!sid) return;
    overTrigger = true; clearTimeout(hideTimer);
    if (curSession === sid && card) return;          // 已显示该会话
    if (pendingSid === sid && showTimer) return;     // 已排程
    clearTimeout(showTimer);
    pendingSid = sid;
    var triggerEl = t;
    showTimer = setTimeout(function () {
      showTimer = null; pendingSid = null;
      if (overTrigger) showCard(triggerEl, sid);
    }, SHOW_DELAY);
  }, true);

  document.addEventListener('mouseout', function (e) {
    if (!(e.target instanceof Element)) return;
    var t = e.target.closest('[data-session-id]');
    if (!t) return;
    var to = e.relatedTarget;
    if (to instanceof Node) {
      if (t.contains(to)) return;
      if (card && card.contains(to)) return;
    }
    overTrigger = false;
    clearTimeout(showTimer); showTimer = null; pendingSid = null;  // 取消未触发的延迟显示
    scheduleHide();
  }, true);

  // 坐标兜底：每次移动都更新坐标，并校验鼠标是否真的还在卡片/触发项上。
  // 这能修复「mouseout/mouseleave 事件丢失导致浮窗不消失」的残留问题
  // （快速移出窗口、列表重渲染换了 DOM、虚拟列表回收触发项等情况）。
  document.addEventListener('mousemove', function (e) {
    lastPt.x = e.clientX; lastPt.y = e.clientY;
    if (card) recheckPointer();
  }, true);

  // 鼠标移出整个文档（窗口外）/ 窗口失焦：直接收起。
  document.addEventListener('mouseleave', function () {
    overTrigger = false; overCard = false; scheduleHide();
  }, true);
  window.addEventListener('blur', function () {
    overTrigger = false; overCard = false; removeCard();
  });

  // 滚动时触发项可能被虚拟列表回收/移位，重新用坐标校验一次。
  document.addEventListener('scroll', function () { if (card) recheckPointer(); }, true);

  console.log('[opencode-hover] installed');
})();
