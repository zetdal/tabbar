// ==UserScript==
// @name         Zeta 탭바 위치 조정 (드래그 가능)
// @namespace    zeta-tabbar-reposition
// @version      1.4
// @description  Zeta AI 탭바를 화면 아무 곳에나 드래그해서 배치, 세로/가로 자동 전환 (v1.4: 위치를 바깥 제타 페이지에 저장 → 새로고침해도 유지)
// @match        https://zeta-ai.io/*
// @match        https://frame.pingpong.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// ---------- [v1.2] 채팅 iframe 쪽: 유저 말풍선 색을 바깥 페이지로 전달 ----------
// 채팅방이 frame.pingpong.ai iframe 안으로 옮겨져서 바깥 페이지(탭바가 있는 곳)에서는 말풍선 색을 직접 못 읽음.
// → iframe 안에서 색을 읽어 바깥으로 보내주고, 바깥 탭바는 그 색을 1순위로 사용.
(() => {
  'use strict';
  if (!/(^|\.)pingpong\.ai$/.test(location.hostname)) return;
  if (window.__ZETA_TABBAR_ACCENT_FRAME__) return;
  window.__ZETA_TABBAR_ACCENT_FRAME__ = true;

  const readBubbleColor = () => {
    const bubble = document.querySelector(
      '[class*="bg-bubble-user"],[class*="fruit-user-bubble"],.self-end[class*="rounded-l-xl"]'
    );
    if (!bubble) return null;
    const cs = getComputedStyle(bubble);
    const bw = parseFloat(cs.borderTopWidth || '0');
    if (bw >= 1 && cs.borderTopColor) return { border: cs.borderTopColor, bg: cs.backgroundColor };
    return { border: null, bg: cs.backgroundColor };
  };

  const send = () => {
    const c = readBubbleColor();
    if (!c) return;
    try {
      window.parent.postMessage({ type: 'zeta-tabbar-accent', border: c.border, bg: c.bg }, '*');
    } catch (e) {}
  };

  // 테마가 늦게 적용되거나 색이 바뀌는 경우까지 따라가도록 주기적으로 전송 (가벼운 작업)
  send();
  setInterval(send, 1000);
})();

// ---------- 탭바 위치/색 조정 ----------
// [v1.3] ZETAKIT을 채팅 iframe 안에서 실행하면 탭바(퀵바)도 iframe 안에 생기므로
//        바깥 페이지와 iframe 양쪽에서 모두 동작 (탭바가 있는 쪽에서만 실제로 적용됨)
(() => {
  'use strict';

  // ---------- [v1.4] 바깥 페이지 저장 다리 ----------
  // 사파리는 채팅 iframe(frame.pingpong.ai) 안의 저장공간을 임시로만 씀 (새로고침·앱 종료 시 사라짐).
  // → iframe 안에서는 바깥 제타 페이지(zeta-ai.io) 저장공간에 대신 저장하고 불러옴.
  //   (바깥 페이지에서도 이 스크립트가 돌면서 iframe의 부탁을 받아 처리)
  const makeTopStore = (owner, keys) => {
    const TOP_RE = /^https:\/\/([a-z0-9-]+\.)*zeta-ai\.io$/;
    const FRAME_RE = /^https:\/\/([a-z0-9-]+\.)*pingpong\.ai$/;
    const allowed = (k) => keys.indexOf(k) >= 0;
    if (window.top === window) {
      // 바깥 페이지: iframe 부탁 처리
      if (!TOP_RE.test(location.origin) || window['__ZTS_' + owner]) return null;
      window['__ZTS_' + owner] = true;
      window.addEventListener('message', (e) => {
        if (!FRAME_RE.test(e.origin) || !e.source) return;
        const d = e.data;
        if (!d || d.__zts !== 1 || d.owner !== owner || !allowed(d.key)) return;
        let value = null;
        try {
          if (d.op === 'get') value = localStorage.getItem(d.key);
          else if (d.op === 'set') localStorage.setItem(d.key, d.value);
        } catch (err) {}
        try { e.source.postMessage({ __zts: 1, owner, reply: d.id, value }, e.origin); } catch (err) {}
      });
      return null;
    }
    // iframe 안
    let parentOrigin = null;
    try {
      const ao = location.ancestorOrigins && location.ancestorOrigins[0];
      if (ao && TOP_RE.test(ao)) parentOrigin = ao;
    } catch (e) {}
    if (!parentOrigin) {
      try { const r = new URL(document.referrer).origin; if (TOP_RE.test(r)) parentOrigin = r; } catch (e) {}
    }
    let seq = 0;
    const waiting = new Map();
    window.addEventListener('message', (e) => {
      if (!TOP_RE.test(e.origin)) return;
      const d = e.data;
      if (!d || d.__zts !== 1 || d.owner !== owner || !waiting.has(d.reply)) return;
      waiting.get(d.reply)(d.value);
    });
    const ask = (op, key, value) => new Promise((resolve) => {
      if (!parentOrigin) { resolve(undefined); return; }
      const id = owner + '_' + (++seq) + '_' + Date.now();
      const timer = setTimeout(() => { waiting.delete(id); resolve(undefined); }, 2500);
      waiting.set(id, (v) => { clearTimeout(timer); waiting.delete(id); resolve(v); });
      try { window.parent.postMessage({ __zts: 1, owner, id, op, key, value }, parentOrigin); }
      catch (e) { clearTimeout(timer); waiting.delete(id); resolve(undefined); }
    });
    return {
      // 바깥 값 (문자열 또는 null). 바깥 응답이 없으면 undefined
      get: (key) => ask('get', key),
      set: (key, value) => {
        try { localStorage.setItem(key, value); } catch (e) {}
        return ask('set', key, value);
      },
    };
  };

  // 로어 버튼 추가됨 (2026-08 업데이트)
  const LABELS = ['검토', '새답변', '추천', '무응답', '퀵', '이력', '로어', '설정', '×', 'X', 'x'];
  const ACTIVE = ['검토', '새답변', '추천', '무응답'];

  const parseColor = (str) => {
    if (!str) return null;
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const r = +m[1], g = +m[2], b = +m[3];
    const hex = n => n.toString(16).padStart(2, '0');
    const isGrayish = Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && Math.abs(r - b) < 12;
    if (isGrayish) return null;
    return '#' + hex(r) + hex(g) + hex(b);
  };

  const normalizeColorValue = (raw) => {
    if (!raw) return null;
    raw = raw.trim();
    if (!raw) return null;
    if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) {
      return raw.length === 4
        ? '#' + [...raw.slice(1)].map(c => c + c).join('')
        : raw;
    }
    return parseColor(raw);
  };

  const VAR_CANDIDATES = [
    '--accent', '--accent-color', '--primary', '--primary-color',
    '--theme-color', '--brand', '--brand-color', '--color-primary',
    '--color-accent', '--tw-accent', '--chakra-colors-brand-500'
  ];

  const getAccentFromCssVars = () => {
    const roots = [document.documentElement, document.body].filter(Boolean);
    for (const root of roots) {
      const cs = getComputedStyle(root);
      for (const name of VAR_CANDIDATES) {
        const c = normalizeColorValue(cs.getPropertyValue(name));
        if (c) return c;
      }
    }
    return null;
  };

  // 1순위: {{user}} 말풍선 색 (아래 getAccentFromBubble)
  // 2순위: 대화 하이라이터 색 (merged-v1 테마의 --dialogue-hl 변수)
  const getAccentFromHighlighter = () => {
    const cs = getComputedStyle(document.documentElement);
    return normalizeColorValue(cs.getPropertyValue('--dialogue-hl'));
  };

  // 3순위: 입력창 전송 버튼 색
  const getAccentFromSendButton = () => {
    const btn = document.querySelector('[data-testid="chat-send-button"]');
    if (!btn) return null;
    return normalizeColorValue(getComputedStyle(btn).backgroundColor);
  };

  let cachedBubbleEl = null;

  const getAccentFromBubble = () => {
    const bubble = document.querySelector(
      '[class*="bg-bubble-user"],[class*="fruit-user-bubble"],.self-end[class*="rounded-l-xl"]'
    );
    cachedBubbleEl = bubble || null;
    if (bubble) {
      const cs = getComputedStyle(bubble);
      const bw = parseFloat(cs.borderTopWidth || '0');
      if (bw >= 1) {
        const c = parseColor(cs.borderTopColor);
        if (c) return c;
      }
      const bg = parseColor(cs.backgroundColor);
      if (bg) return bg;
    }
    return null;
  };

  // [v1.2] iframe에서 받은 유저 말풍선 색 (테두리 색 우선, 없으면 배경색 — 예전 getAccentFromBubble과 같은 기준)
  let frameAccent = null;
  window.addEventListener('message', (e) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*pingpong\.ai$/.test(e.origin)) return;
    const d = e.data;
    if (!d || d.type !== 'zeta-tabbar-accent') return;
    const c = (d.border && parseColor(d.border)) || (d.bg && parseColor(d.bg)) || null;
    if (c && c !== frameAccent) {
      frameAccent = c;
      const bar = findTabBar();
      if (bar) applyStyle(bar, true);
    }
  });

  const getAccent = () => {
    return frameAccent
      || getAccentFromBubble()
      || getAccentFromHighlighter()
      || getAccentFromSendButton()
      || getAccentFromCssVars()
      || '#FF8A65';
  };

  const findToggle = () => {
    const all = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
    return all.find(el => el.offsetParent !== null && el.textContent?.trim() === 'zeta');
  };

  const MAX_PARENT_HOPS = 5;
  const MAX_CONTAINER_SIZE = 400;

  const findTabBar = () => {
    const all = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
    const btns = ACTIVE.map(label => all.find(el => el.textContent?.trim() === label)).filter(Boolean);
    if (btns.length < 3) return null;

    const directParent = btns[0].parentElement;
    if (directParent && btns.every(b => b.parentElement === directParent)) {
      const rect = directParent.getBoundingClientRect();
      if (rect.width <= MAX_CONTAINER_SIZE * 3 && rect.height <= MAX_CONTAINER_SIZE) {
        return directParent;
      }
    }

    let container = btns[0].parentElement;
    let hops = 0;
    while (container && hops < MAX_PARENT_HOPS) {
      const containsAll = btns.every(b => container.contains(b));
      if (containsAll) break;
      container = container.parentElement;
      hops++;
    }

    if (!container) return null;
    if (container === document.body || container === document.documentElement) return null;

    const rect = container.getBoundingClientRect();
    if (rect.width > MAX_CONTAINER_SIZE || rect.height > MAX_CONTAINER_SIZE) return null;

    return container;
  };

  const STORAGE_KEY = 'zeta_tabbar_pos_v1';
  const topStore = makeTopStore('tabbar', [STORAGE_KEY]);
  let userMoved = false;

  const loadSavedPos = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (typeof data.x === 'number' && typeof data.y === 'number') return data;
    } catch (e) {}
    return null;
  };

  const savePos = () => {
    const raw = JSON.stringify({ x: pos.x, y: pos.y });
    if (topStore) { topStore.set(STORAGE_KEY, raw); return; }
    try {
      localStorage.setItem(STORAGE_KEY, raw);
    } catch (e) {}
  };

  const computeOrientation = () => {
    const h = window.innerHeight;
    const topZone = h * 0.22, bottomZone = h * 0.78;
    return (pos.y < topZone || pos.y > bottomZone) ? 'horizontal' : 'vertical';
  };

  const saved = loadSavedPos();
  let pos = saved ? { x: saved.x, y: saved.y } : null;
  let orientation = 'vertical';
  let lastAccent = null;

  // [v1.4] iframe 안에서는 바깥에 저장된 위치를 불러와서 적용
  if (topStore) {
    topStore.get(STORAGE_KEY).then((raw) => {
      if (!raw || userMoved) return;
      try {
        const data = JSON.parse(raw);
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
        try { localStorage.setItem(STORAGE_KEY, raw); } catch (e) {}
        pos = { x: Math.min(Math.max(data.x, 0), window.innerWidth - 40), y: Math.min(Math.max(data.y, 0), window.innerHeight - 40) };
        orientation = computeOrientation();
        const bar = findTabBar();
        if (bar) applyStyle(bar, true);
      } catch (e) {}
    });
  }

  const applyStyle = (container, force) => {
    if (!container) return;
    const accent = getAccent();
    if (!force && accent === lastAccent && container.dataset.dragSetup) return;
    lastAccent = accent;

    if (!container.dataset.dragSetup) {
      container.dataset.dragSetup = 'true';
      container.style.setProperty('position', 'fixed', 'important');
      if (!pos) pos = { x: window.innerWidth - 90, y: window.innerHeight - 320 };
      pos.x = Math.min(Math.max(pos.x, 0), window.innerWidth - 40);
      pos.y = Math.min(Math.max(pos.y, 0), window.innerHeight - 40);
      orientation = computeOrientation();

      let dragging = false, ox = 0, oy = 0;

      const start = e => {
        dragging = true;
        const t = e.touches ? e.touches[0] : e;
        ox = t.clientX - pos.x;
        oy = t.clientY - pos.y;
      };

      const move = e => {
        if (!dragging) return;
        const t = e.touches ? e.touches[0] : e;
        pos = { x: t.clientX - ox, y: t.clientY - oy };
        container.style.setProperty('left', pos.x + 'px', 'important');
        container.style.setProperty('top', pos.y + 'px', 'important');
        container.style.setProperty('right', 'auto', 'important');
        container.style.setProperty('bottom', 'auto', 'important');
        e.preventDefault();
      };

      const end = () => {
        if (!dragging) return;
        dragging = false;
        userMoved = true;
        orientation = computeOrientation();
        applyStyle(container, true);
        savePos();
      };

      container.addEventListener('touchstart', start, { passive: true });
      container.addEventListener('touchmove', move, { passive: false });
      container.addEventListener('touchend', end, { passive: true });
      container.addEventListener('mousedown', start);
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', end);
    }

    const isH = orientation === 'horizontal';
    Object.assign(container.style, {
      position: 'fixed',
      left: pos.x + 'px',
      top: pos.y + 'px',
      right: 'auto',
      bottom: 'auto',
      display: 'flex',
      flexDirection: isH ? 'row' : 'column',
      flexWrap: 'nowrap',
      gap: '3px',
      zIndex: 9999,
      width: 'auto'
    });

    container.style.setProperty('background', '#FFFFFF', 'important');
    container.style.setProperty('border', '1px solid ' + accent + '40', 'important');
    container.style.setProperty('border-radius', '14px', 'important');
    container.style.setProperty('padding', '6px', 'important');
    container.style.setProperty('box-shadow', '0 2px 8px rgba(0,0,0,0.08)', 'important');

    const buttons = container.querySelectorAll('button, [role="button"], div, span');
    buttons.forEach(el => {
      const text = el.textContent?.trim();
      if (!LABELS.includes(text) || el.children.length !== 0) return;
      const isActive = ACTIVE.includes(text);
      el.style.setProperty('background', isActive ? accent + '1F' : '#F2F2F7', 'important');
      el.style.setProperty('color', isActive ? accent : '#8E8E93', 'important');
      el.style.setProperty('border', '1px solid ' + (isActive ? accent + '50' : '#E5E5EA'), 'important');
      el.style.setProperty('border-radius', '7px', 'important');
      el.style.setProperty('padding', isH ? '2px 0' : '4px 0', 'important');
      el.style.setProperty('font-size', isH ? '9px' : '10px', 'important');
      el.style.setProperty('font-weight', '600', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
      el.style.setProperty('text-align', 'center', 'important');
      el.style.setProperty('white-space', 'nowrap', 'important');
      el.style.setProperty('width', isH ? '34px' : '48px', 'important');
      el.style.setProperty('min-width', isH ? '34px' : '48px', 'important');
      el.style.setProperty('max-width', isH ? '34px' : '48px', 'important');
      el.style.setProperty('box-sizing', 'border-box', 'important');
    });
  };

  const tryOpen = () => {
    const bar = findTabBar();
    if (bar && bar.offsetParent !== null) {
      applyStyle(bar, true);
      return true;
    }
    const toggle = findToggle();
    if (toggle) toggle.click();
    return false;
  };

  let attempts = 0;
  const openInterval = setInterval(() => {
    if (tryOpen() || attempts > 20) {
      clearInterval(openInterval);
    }
    attempts++;
  }, 150);

  const observer = new MutationObserver(() => {
    const bar = findTabBar();
    if (bar) applyStyle(bar, false);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });

  const refreshColor = () => {
    const bar = findTabBar();
    if (bar) applyStyle(bar, true);
  };

  const colorWatch = setInterval(refreshColor, 300);

  document.addEventListener('click', () => {
    setTimeout(refreshColor, 50);
    setTimeout(refreshColor, 250);
  }, { capture: true, passive: true });

  let bubbleObserver = null;
  const watchBubble = () => {
    getAccentFromBubble();
    if (!cachedBubbleEl) return;
    if (bubbleObserver) bubbleObserver.disconnect();
    bubbleObserver = new MutationObserver(() => {
      refreshColor();
    });
    bubbleObserver.observe(cachedBubbleEl, { attributes: true, attributeFilter: ['style', 'class'] });
  };
  setInterval(watchBubble, 1000);

  setInterval(() => {
    window.dispatchEvent(new Event('resize'));
  }, 2000);

  window.__ZETA_TABBAR_REPOSITION__ = observer;
  window.__ZETA_TABBAR_COLORWATCH__ = colorWatch;
})();
