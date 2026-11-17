// ==UserScript==
// @name         Zeta 탭바 위치 조정 (드래그 가능)
// @namespace    zeta-tabbar-reposition
// @version      1.5
// @description  Zeta AI 탭바를 화면 아무 곳에나 드래그해서 배치, 세로/가로 자동 전환 (v1.5: 흔들림·렉 수정, 위치는 바깥 제타 페이지에 저장)
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
  // [v1.5] 한 화면에서 두 번 실행되면 서로 위치를 당겨서 흔들리므로 한 번만
  if (window.__ZETA_TABBAR_MAIN__) return;
  window.__ZETA_TABBAR_MAIN__ = true;

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

  // ---------- 위치 저장 ----------
  // v1: ZETAKIT 기본 스타일(가운데 정렬용 translateX(-50%))이 남아 있던 시절 값
  // v2(v1.5~): 그 기울임을 없애고 화면에 보이는 왼쪽 위 좌표 그대로 저장
  const KEY_V1 = 'zeta_tabbar_pos_v1';
  const KEY_V2 = 'zeta_tabbar_pos_v2';
  const topStore = makeTopStore('tabbar', [KEY_V1, KEY_V2]);
  let userMoved = false;

  const parsePos = (raw, v) => {
    try {
      const d = JSON.parse(raw);
      if (d && typeof d.x === 'number' && typeof d.y === 'number') return { x: d.x, y: d.y, v };
    } catch (e) {}
    return null;
  };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const loadSavedPos = () => parsePos(lsGet(KEY_V2), 2) || parsePos(lsGet(KEY_V1), 1);

  const savePos = () => {
    const raw = JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) });
    if (topStore) { topStore.set(KEY_V2, raw); return; }
    try { localStorage.setItem(KEY_V2, raw); } catch (e) {}
  };

  const clampPos = (p, el) => {
    const w = el ? el.offsetWidth : 40, h = el ? el.offsetHeight : 40;
    p.x = Math.min(Math.max(p.x, 0), Math.max(0, window.innerWidth - Math.min(w, 60)));
    p.y = Math.min(Math.max(p.y, 0), Math.max(0, window.innerHeight - Math.min(h, 40)));
    return p;
  };

  const computeOrientation = () => {
    const h = window.innerHeight;
    const topZone = h * 0.22, bottomZone = h * 0.78;
    return (pos.y < topZone || pos.y > bottomZone) ? 'horizontal' : 'vertical';
  };

  let pos = loadSavedPos();
  let orientation = 'vertical';
  let barEl = null;      // 찾아둔 탭바
  let applied = '';      // 마지막으로 적용한 상태 (같으면 다시 안 씀)

  // [v1.4] iframe 안에서는 바깥에 저장된 위치를 불러와서 적용
  if (topStore) {
    Promise.all([topStore.get(KEY_V2), topStore.get(KEY_V1)]).then(([r2, r1]) => {
      if (userMoved) return;
      const p = parsePos(r2, 2) || parsePos(r1, 1);
      if (!p) return;
      pos = p;
      if (barEl && barEl.isConnected) placeBar(barEl, true);
    });
  }

  // 위치/방향만 적용 (값이 바뀔 때만 실제로 씀 → 화면 흔들림·렉 방지)
  const placeBar = (el, force) => {
    if (!pos) pos = { x: window.innerWidth - 90, y: window.innerHeight - 320, v: 2 };
    if (force) applied = '';
    orientation = computeOrientation();
    const isH = orientation === 'horizontal';
    const state = [Math.round(pos.x), Math.round(pos.y), orientation, lastAccent].join('|');
    // 다른 코드가 위치를 바꿔놨으면 다시 맞춤
    const drifted = el.style.left !== Math.round(pos.x) + 'px' || el.style.top !== Math.round(pos.y) + 'px';
    if (state === applied && !drifted) return;
    applied = state;

    const set = (k, v) => { if (el.style.getPropertyValue(k) !== v || el.style.getPropertyPriority(k) !== 'important') el.style.setProperty(k, v, 'important'); };
    set('position', 'fixed');
    set('transform', 'none');           // ZETAKIT 기본 가운데 정렬(translateX(-50%)) 끔
    set('right', 'auto');
    set('bottom', 'auto');
    set('display', 'flex');
    set('flex-direction', isH ? 'row' : 'column');
    set('flex-wrap', 'nowrap');
    set('gap', '3px');
    set('z-index', '9999');
    set('width', 'auto');
    set('max-width', 'calc(100vw - 8px)');
    set('transition', 'none');

    // v1 저장값(가운데 정렬 기준) → 실제 왼쪽 좌표로 한 번만 바꿔서 저장
    if (pos.v === 1) {
      set('left', Math.round(pos.x) + 'px');
      set('top', Math.round(pos.y) + 'px');
      pos.x = pos.x - el.offsetWidth / 2;
      pos.v = 2;
      clampPos(pos, el);
      savePos();
      applied = [Math.round(pos.x), Math.round(pos.y), orientation, lastAccent].join('|');
    }
    set('left', Math.round(pos.x) + 'px');
    set('top', Math.round(pos.y) + 'px');
  };

  let lastAccent = null;
  let paintedAccent = null;
  let paintedOrientation = null;

  // 색/버튼 모양 (색이나 방향이 바뀔 때만)
  const paintBar = (container, accent) => {
    const isH = orientation === 'horizontal';
    if (accent === paintedAccent && orientation === paintedOrientation && container.dataset.ztPainted === '1') return;
    paintedAccent = accent;
    paintedOrientation = orientation;
    container.dataset.ztPainted = '1';

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

  const setupDrag = (container) => {
    if (container.dataset.dragSetup) return;
    container.dataset.dragSetup = 'true';
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
      pos = clampPos({ x: t.clientX - ox, y: t.clientY - oy, v: 2 }, container);
      container.style.setProperty('left', Math.round(pos.x) + 'px', 'important');
      container.style.setProperty('top', Math.round(pos.y) + 'px', 'important');
      e.preventDefault();
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      userMoved = true;
      applyStyle(container, true);
      savePos();
    };

    container.addEventListener('touchstart', start, { passive: true });
    container.addEventListener('touchmove', move, { passive: false });
    container.addEventListener('touchend', end, { passive: true });
    container.addEventListener('touchcancel', end, { passive: true });
    container.addEventListener('mousedown', start);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
  };

  const applyStyle = (container, force) => {
    if (!container) return;
    lastAccent = getAccent();
    setupDrag(container);
    placeBar(container, force);
    paintBar(container, lastAccent);
  };

  // 탭바 찾기: 찾아둔 게 살아 있으면 그대로, ZETAKIT 탭바는 id로 바로 (무거운 전체 검색은 최소화)
  const getBar = () => {
    if (barEl && barEl.isConnected) return barEl;
    barEl = document.getElementById('zk_review_quickbar') || findTabBar();
    if (barEl) { applied = ''; paintedAccent = null; }
    return barEl;
  };

  const tryOpen = () => {
    const bar = getBar();
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

  // 탭바가 새로 생기는지만 가볍게 감시 (속성 변화까지 보면 스타일 쓸 때마다 다시 불려서 렉 유발)
  let moTimer = null;
  const observer = new MutationObserver(() => {
    if (barEl && barEl.isConnected) return;
    if (moTimer) return;
    moTimer = setTimeout(() => {
      moTimer = null;
      const bar = getBar();
      if (bar) applyStyle(bar, true);
    }, 200);
  });
  const startObserve = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) startObserve(); else document.addEventListener('DOMContentLoaded', startObserve);

  // 색 바뀜 / 다른 코드가 위치를 건드렸는지 1초마다 확인 (바뀐 게 없으면 아무것도 안 씀)
  const refreshColor = () => {
    const bar = getBar();
    if (bar) applyStyle(bar, false);
  };
  const colorWatch = setInterval(refreshColor, 1000);

  document.addEventListener('click', () => {
    setTimeout(refreshColor, 250);
  }, { capture: true, passive: true });

  window.addEventListener('resize', () => {
    if (!barEl || !barEl.isConnected || !pos) return;
    clampPos(pos, barEl);
    placeBar(barEl, false);
  });

  window.__ZETA_TABBAR_REPOSITION__ = observer;
  window.__ZETA_TABBAR_COLORWATCH__ = colorWatch;
})();
