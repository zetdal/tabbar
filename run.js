// ==UserScript==
// @name         Zeta 탭바 위치 조정 (드래그 가능)
// @namespace    zeta-tabbar-reposition
// @version      1.1
// @description  Zeta AI 탭바를 화면 아무 곳에나 드래그해서 배치, 세로/가로 자동 전환
// @match        https://zeta-ai.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

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

  const getAccent = () => {
    return getAccentFromBubble()
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
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
