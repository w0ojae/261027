const clamp = value => Math.max(0, Math.min(1, value));
const CONTROLS = 'input, textarea, select, button, a[href], dialog, [role="dialog"], [role="slider"], [contenteditable]:not([contenteditable="false"])';
const WHEEL_DISTANCE = 1800;
const TOUCH_DISTANCE = 460;
const EPSILON = .0008;
const SPRING_OMEGA = 9;

/**
 * Reversible introduction, driven by the existing render loop with update(seconds).
 * setProgress(value, immediate=false) changes its destination; immediate also sets
 * the displayed value. No movement is accepted until setReady(true). The caller
 * owns content inertness, focus, audio and the overlay's accessibility visibility.
 */
export function createIntroScroll({
  host = globalThis.document,
  root = globalThis.document?.documentElement,
  overlay,
  reducedMotion = false,
  onProgress,
  onActiveChange,
  onEntered,
  onReturned,
  canInteract = () => true,
} = {}) {
  if (!host?.addEventListener || !root?.style) throw new TypeError('Intro event host and styled root are required.');
  const previousProgress = root.style.getPropertyValue('--intro-progress');
  const previousPriority = root.style.getPropertyPriority('--intro-progress');
  const previousState = root.getAttribute('data-intro-state');
  let progress = 0, target = 0, velocity = 0, ready = false, active = true, disposed = false;
  let endpoint = 0;
  let touch = null;

  function syncActive() {
    const next = progress < 1 || target < 1;
    if (active !== next) { active = next; onActiveChange?.(active); }
  }

  function paint() {
    root.style.setProperty('--intro-progress', String(progress));
    root.setAttribute('data-intro-state', !ready ? 'loading' : progress === 0 && target === 0 ? 'intro' : progress === 1 && target === 1 ? 'entered' : 'transition');
    onProgress?.(progress);
    if (progress !== 0 && progress !== 1) endpoint = null;
    if (progress === target && (progress === 0 || progress === 1) && endpoint !== progress) {
      endpoint = progress;
      if (progress === 1) onEntered?.();
      else onReturned?.();
    }
  }

  function setProgress(value, immediate = false) {
    if (disposed || !Number.isFinite(value) || (!ready && value !== 0)) return false;
    target = clamp(value);
    // An opposite destination must respond immediately, without old momentum.
    if ((target - progress) * velocity < 0 || target === progress) velocity = 0;
    // Suspend garden controls before the first frame of a returning fade.
    syncActive();
    if (immediate) { progress = target; velocity = 0; }
    syncActive();
    paint();
    return true;
  }

  function nudge(amount) {
    // Reverse from the visible position, without waiting for queued easing.
    const origin = amount * (target - progress) < 0 ? progress : target;
    setProgress(origin + amount);
  }

  const control = element => !!element?.closest?.(CONTROLS);
  const blocked = event => disposed || event.defaultPrevented || !canInteract(event) || control(event.target) || !!host.querySelector?.('dialog[open], [role="dialog"][aria-modal="true"]');
  function consume(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation?.();
  }

  function wheel(event) {
    if (blocked(event)) return;
    if ((event.ctrlKey || event.metaKey) && !active) return;
    const dx = Number(event.deltaX) || 0, dy = Number(event.deltaY) || 0;
    if (!Number.isFinite(dy) || !dy || Math.abs(dx) > Math.abs(dy)) return;
    // Browser pinch/zoom must not move the progress while the intro is visible.
    consume(event);
    if (!ready || event.ctrlKey || event.metaKey) return;
    const page = Math.max(1, root.clientHeight || host.defaultView?.innerHeight || 800);
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? page : 1;
    nudge(dy * scale / WHEEL_DISTANCE);
  }

  function keydown(event) {
    if (blocked(event) || control(host.activeElement) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key || event.code;
    let destination;
    if (key === 'Home') destination = 0;
    else if (key === 'End') destination = 1;
    else if (key === 'Enter' && overlay?.contains?.(event.target)) destination = 1;
    else if (['ArrowDown', 'PageDown', ' ', 'Space', 'Spacebar'].includes(key)) destination = event.shiftKey && [' ', 'Space', 'Spacebar'].includes(key) ? -.2 : .2;
    else if (key === 'ArrowUp' || key === 'PageUp') destination = -.2;
    else return;
    consume(event);
    if (!ready) return;
    if (key === 'Home' || key === 'End' || key === 'Enter') setProgress(destination);
    else nudge(destination);
  }

  function touchstart(event) {
    touch = null;
    if (!active || blocked(event) || event.touches?.length !== 1) return;
    const point = event.touches[0];
    touch = { id: point.identifier, x: point.clientX, y: point.clientY, lastY: point.clientY, vertical: false };
  }

  function touchmove(event) {
    if (!touch || !active || blocked(event) || event.touches?.length !== 1) { touch = null; return; }
    const point = Array.from(event.touches).find(point => point.identifier === touch.id);
    if (!point) { touch = null; return; }
    if (!touch.vertical) {
      const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { touch = null; return; }
      touch.vertical = true;
    }
    consume(event);
    if (ready) nudge((touch.lastY - point.clientY) / TOUCH_DISTANCE);
    touch.lastY = point.clientY;
  }

  function touchend() { touch = null; }
  const listeners = [
    ['wheel', wheel, { capture: true, passive: false }],
    ['keydown', keydown, true],
    ['touchstart', touchstart, { capture: true, passive: true }],
    ['touchmove', touchmove, { capture: true, passive: false }],
    ['touchend', touchend, true],
    ['touchcancel', touchend, true],
  ];
  for (const args of listeners) host.addEventListener(...args);
  onActiveChange?.(true);
  paint();

  return {
    setReady(value) {
      if (disposed) return;
      ready = !!value;
      if (!ready) { touch = null; setProgress(0, true); }
      else paint();
    },
    setProgress,
    update(seconds) {
      if (disposed || !Number.isFinite(seconds) || seconds <= 0 || progress === target) return;
      let next;
      if (reducedMotion) {
        velocity = 0;
        next = progress + (target - progress) * (1 - Math.exp(-seconds * 36));
      } else {
        // Exact critically damped spring: acceleration starts gently and the
        // same elapsed time gives the same motion at different frame rates.
        const error = progress - target;
        const c = velocity + SPRING_OMEGA * error;
        const decay = Math.exp(-SPRING_OMEGA * seconds);
        const elapsedDecay = seconds * decay;
        next = target + error * decay + c * elapsedDecay;
        velocity = velocity * decay - SPRING_OMEGA * c * elapsedDecay;
      }
      // A nearer destination can meet existing momentum. Stop at that target
      // instead of overshooting or reopening the scene controls prematurely.
      if ((target - progress) * (target - next) <= 0 || Math.abs(next - target) < EPSILON) {
        progress = target;
        velocity = 0;
      } else progress = next;
      syncActive();
      paint();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      touch = null;
      for (const args of listeners) host.removeEventListener(...args);
      if (previousProgress) root.style.setProperty('--intro-progress', previousProgress, previousPriority);
      else root.style.removeProperty('--intro-progress');
      if (previousState === null) root.removeAttribute('data-intro-state');
      else root.setAttribute('data-intro-state', previousState);
      if (active) { active = false; onActiveChange?.(false); }
    },
    get progress() { return progress; },
    get active() { return active; },
  };
}
