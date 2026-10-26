import * as THREE from 'three';

export const PLAYER_RADIUS = 0.14;
const WALK_SPEED = 1.75; // Previous 1.05 scaled by the requested 5/3 ratio.
const MAX_PITCH = 75 * Math.PI / 180;
const LOOK_SENSITIVITY = 0.0035;
const SEATED_MAX_YAW = 70 * Math.PI / 180;
const SEATED_MAX_PITCH_UP = 45 * Math.PI / 180;
const SEATED_MAX_PITCH_DOWN = 55 * Math.PI / 180;
const EPSILON = 1e-9;
const KEY_DIRECTIONS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'backward', ArrowDown: 'backward',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const normalizeAngle = value => Math.atan2(Math.sin(value), Math.cos(value));

function clampAxis(value, min, max, radius) {
  const lower = min + radius;
  const upper = max - radius;
  return upper < lower ? (min + max) / 2 : Math.max(lower, Math.min(upper, value));
}

/** Keep a circular player's center inside the rectangular floor boundary. */
export function clampToBounds(position, bounds = {}, radius = PLAYER_RADIUS) {
  return {
    x: clampAxis(position.x, finite(bounds.minX, -Infinity), finite(bounds.maxX, Infinity), radius),
    z: clampAxis(position.z, finite(bounds.minZ, -Infinity), finite(bounds.maxZ, Infinity), radius),
  };
}

/** Exact circle/rectangle overlap; touching an obstacle is permitted. */
export function cylinderIntersectsObstacle(x, z, radius, obstacle) {
  if (!obstacle || !['minX', 'maxX', 'minZ', 'maxZ'].every(key => Number.isFinite(obstacle[key]))) return false;
  const closestX = Math.max(obstacle.minX, Math.min(obstacle.maxX, x));
  const closestZ = Math.max(obstacle.minZ, Math.min(obstacle.maxZ, z));
  return (x - closestX) ** 2 + (z - closestZ) ** 2 < radius ** 2 - EPSILON;
}

/**
 * Pure, non-mutating horizontal movement with circular collision and axis sliding.
 * Substeps also prevent large requested movements from tunnelling through a wall.
 */
export function moveWithCollisions(position, dx, dz, zone = {}, radius = PLAYER_RADIUS) {
  const bounds = zone.bounds || {};
  const obstacles = zone.obstacles || [];
  let { x, z } = clampToBounds(position, bounds, radius);
  let blockedX = false;
  let blockedZ = false;
  dx = finite(dx); dz = finite(dz);
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.max(radius * 0.5, 0.01)));
  const stepX = dx / steps;
  const stepZ = dz / steps;
  const overlaps = (px, pz) => obstacles.some(obstacle => cylinderIntersectsObstacle(px, pz, radius, obstacle));

  function moveAxis(axis, amount) {
    if (!amount) return;
    const start = axis === 'x' ? x : z;
    const candidate = clampToBounds({ x: x + (axis === 'x' ? amount : 0), z: z + (axis === 'z' ? amount : 0) }, bounds, radius);
    let destination = candidate[axis];
    let blocked = Math.abs(destination - (start + amount)) > EPSILON;
    if (overlaps(candidate.x, candidate.z)) {
      blocked = true;
      // Resolve to the nearest safe point instead of leaving a frame-sized gap.
      let low = 0, high = 1;
      for (let iteration = 0; iteration < 12; iteration++) {
        const fraction = (low + high) / 2;
        const value = start + (destination - start) * fraction;
        if (overlaps(axis === 'x' ? value : x, axis === 'z' ? value : z)) high = fraction;
        else low = fraction;
      }
      destination = start + (destination - start) * low;
    }
    if (axis === 'x') { x = destination; blockedX ||= blocked; }
    else { z = destination; blockedZ ||= blocked; }
  }

  for (let index = 0; index < steps; index++) {
    moveAxis('x', stepX);
    moveAxis('z', stepZ);
  }
  return { x, z, blocked: blockedX || blockedZ, blockedX, blockedZ };
}

/** First-person walking without pointer lock, including touch drag and a mobile pad. */
export function createFirstPerson({ canvas, onExit, onFloorChange, onMovementBlocked } = {}) {
  if (!canvas?.addEventListener) throw new TypeError('A canvas is required for first-person navigation.');
  const camera = new THREE.PerspectiveCamera(68, 1, 0.025, 150);
  camera.rotation.order = 'YXZ';
  const keyboard = new Set();
  const mobile = new Set();
  const previousTabIndex = canvas.getAttribute('tabindex');
  let active = false;
  let suspended = false;
  let disposed = false;
  let listenersAttached = false;
  let currentFloor;
  let currentZone;
  let seatState = null;
  let pointerId = null;
  let pointerX = 0, pointerY = 0;
  let blockedCooldown = 0;

  const dialogOpen = () => !!document.querySelector('dialog[open]');
  const formControl = target => !!target?.closest?.('input, textarea, select, button, dialog, [contenteditable]:not([contenteditable="false"])');

  function releasePointer() {
    const id = pointerId;
    pointerId = null;
    if (id !== null) {
      try { if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id); } catch { /* Pointer may already have ended. */ }
    }
  }

  function clearInput() {
    keyboard.clear();
    mobile.clear();
    releasePointer();
  }

  function focusCanvas() {
    if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
    try { canvas.focus({ preventScroll: true }); } catch { canvas.focus?.(); }
  }

  function look(yawDelta = 0, pitchDelta = 0) {
    if (!active || suspended || disposed || dialogOpen()) return;
    if (seatState) {
      seatState.offset = Math.max(-seatState.maxYaw, Math.min(seatState.maxYaw, seatState.offset + finite(yawDelta)));
      seatState.pitch = Math.max(-SEATED_MAX_PITCH_DOWN, Math.min(SEATED_MAX_PITCH_UP, seatState.pitch + finite(pitchDelta)));
      camera.rotation.set(seatState.pitch, normalizeAngle(seatState.yaw + seatState.offset), 0, 'YXZ');
      return;
    }
    const yaw = camera.rotation.y + finite(yawDelta);
    camera.rotation.y = normalizeAngle(yaw);
    camera.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.rotation.x + finite(pitchDelta)));
    camera.rotation.z = 0;
  }

  function exit() {
    active = false;
    suspended = false;
    seatState = null;
    clearInput();
    blockedCooldown = 0;
  }

  function keyDown(event) {
    if (!active || disposed) return;
    if (event.code === 'Escape' || event.key === 'Escape') {
      if (dialogOpen()) return;
      event.preventDefault();
      exit();
      onExit?.();
      return;
    }
    if (suspended || dialogOpen() || formControl(event.target) || formControl(document.activeElement)) return;
    if (!KEY_DIRECTIONS[event.code] || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code.startsWith('Arrow')) event.preventDefault();
    if (!seatState) keyboard.add(event.code);
  }

  function keyUp(event) {
    const wasHandled = keyboard.delete(event.code);
    if (active && wasHandled && event.code.startsWith('Arrow')) event.preventDefault();
  }

  function pointerDown(event) {
    if (!active || suspended || disposed || dialogOpen() || pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointerId = event.pointerId;
    pointerX = event.clientX; pointerY = event.clientY;
    focusCanvas();
    try { canvas.setPointerCapture?.(pointerId); } catch { /* Capture may be unavailable in an embedded browser. */ }
    if (event.cancelable) event.preventDefault();
  }

  function pointerMove(event) {
    if (!active || event.pointerId !== pointerId) return;
    const dx = event.clientX - pointerX;
    const dy = event.clientY - pointerY;
    pointerX = event.clientX; pointerY = event.clientY;
    look(-dx * LOOK_SENSITIVITY, -dy * LOOK_SENSITIVITY);
    if (event.cancelable) event.preventDefault();
  }

  function pointerEnd(event) {
    if (event.pointerId === pointerId) releasePointer();
  }

  function visibilityChange() { if (document.hidden) clearInput(); }
  function focusChange(event) { if (formControl(event.target)) keyboard.clear(); }

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearInput);
    // Window listeners also finish a drag when pointer capture is unavailable.
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerEnd);
    window.addEventListener('pointercancel', pointerEnd);
    document.addEventListener('visibilitychange', visibilityChange);
    document.addEventListener('focusin', focusChange);
    canvas.addEventListener('pointerdown', pointerDown, { passive: false });
    canvas.addEventListener('lostpointercapture', pointerEnd);
  }

  function setFloor(floor, zone) {
    if (disposed) return;
    if (!zone?.spawn || !['x', 'y', 'z'].every(axis => Number.isFinite(zone.spawn[axis]))) throw new TypeError('A floor zone requires a finite x/y/z spawn.');
    clearInput();
    seatState = null;
    currentFloor = floor;
    currentZone = zone;
    const position = clampToBounds(zone.spawn, zone.bounds, PLAYER_RADIUS);
    const support = zone.heightAt?.(position.x, position.z);
    const eyeY = Number.isFinite(support) && Number.isFinite(zone.eyeHeight) ? support + zone.eyeHeight : zone.spawn.y;
    camera.position.set(position.x, eyeY, position.z);
    camera.rotation.set(Math.max(-MAX_PITCH, Math.min(MAX_PITCH, finite(zone.pitch))), finite(zone.yaw), 0, 'YXZ');
    blockedCooldown = 0;
    onFloorChange?.(floor, zone);
  }

  function enter(floor, zone) {
    if (disposed) return;
    suspended = false;
    setFloor(floor, zone);
    attachListeners();
    active = true;
    focusCanvas();
  }

  function setMove(direction, pressed) {
    const normalized = direction === 'back' ? 'backward' : direction;
    if (!['forward', 'backward', 'left', 'right'].includes(normalized)) return;
    if (!pressed) mobile.delete(normalized);
    else if (active && !suspended && !disposed && !seatState && !dialogOpen()) mobile.add(normalized);
  }

  function setSuspended(value) {
    suspended = Boolean(value);
    clearInput();
  }

  function sit(seat) {
    if (!active || suspended || disposed || seatState || !currentZone || currentFloor === 'outside' || dialogOpen()) return false;
    if (!seat || !['x', 'y', 'z'].every(axis => Number.isFinite(seat.position?.[axis])) || !Number.isFinite(seat.yaw)) return false;
    if (seat.floor !== undefined && String(seat.floor) !== String(currentFloor)) return false;
    const maxYaw = seat.maxYaw === undefined ? SEATED_MAX_YAW : seat.maxYaw;
    if (!Number.isFinite(maxYaw) || maxYaw <= 0 || maxYaw > Math.PI) return false;
    const standing = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    if (!['x', 'y', 'z'].every(axis => Number.isFinite(standing[axis]))) return false;
    const bounded = clampToBounds(standing, currentZone.bounds, PLAYER_RADIUS);
    if (Math.abs(bounded.x - standing.x) > EPSILON || Math.abs(bounded.z - standing.z) > EPSILON ||
      currentZone.obstacles?.some(obstacle => cylinderIntersectsObstacle(standing.x, standing.z, PLAYER_RADIUS, obstacle))) return false;
    clearInput();
    seatState = {
      id: seat.id ?? null,
      position: { x: seat.position.x, y: seat.position.y, z: seat.position.z },
      yaw: normalizeAngle(seat.yaw), maxYaw, offset: 0, pitch: 0, standing,
    };
    camera.position.set(seatState.position.x, seatState.position.y, seatState.position.z);
    camera.rotation.set(0, seatState.yaw, 0, 'YXZ');
    blockedCooldown = 0;
    focusCanvas();
    return true;
  }

  function stand() {
    if (!active || suspended || disposed || !seatState || dialogOpen()) return false;
    const { standing } = seatState;
    seatState = null;
    clearInput();
    camera.position.set(standing.x, standing.y, standing.z);
    camera.rotation.set(0, normalizeAngle(camera.rotation.y), 0, 'YXZ');
    blockedCooldown = 0;
    focusCanvas();
    return true;
  }

  function followSurface(dt) {
    const support = currentZone.heightAt?.(camera.position.x, camera.position.z);
    if (Number.isFinite(support) && Number.isFinite(currentZone.eyeHeight)) {
      const targetY = support + currentZone.eyeHeight;
      // Step up without entering the slab; finish easing down even after input ends.
      camera.position.y = targetY > camera.position.y ? targetY : THREE.MathUtils.lerp(camera.position.y, targetY, 1 - Math.exp(-dt * 14));
    }
  }

  function update(delta) {
    if (!active || suspended || disposed || !currentZone) return;
    if (document.hidden || dialogOpen()) { clearInput(); return; }
    if (seatState) return;
    const dt = Math.max(0, Math.min(0.05, finite(delta)));
    blockedCooldown = Math.max(0, blockedCooldown - dt);
    const directions = new Set([...keyboard].map(code => KEY_DIRECTIONS[code]));
    mobile.forEach(direction => directions.add(direction));
    const forward = Number(directions.has('forward')) - Number(directions.has('backward'));
    const sideways = Number(directions.has('right')) - Number(directions.has('left'));
    const magnitude = Math.hypot(forward, sideways);
    if (!dt) return;
    if (!magnitude) { followSurface(dt); return; }
    const yaw = camera.rotation.y;
    const distance = finite(currentZone.walkSpeed, WALK_SPEED) * dt / magnitude;
    const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * distance;
    const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * distance;
    const result = moveWithCollisions(camera.position, dx, dz, currentZone);
    camera.position.x = result.x;
    camera.position.z = result.z;
    followSurface(dt);
    if (result.blocked && blockedCooldown === 0) {
      blockedCooldown = 1;
      onMovementBlocked?.({ floor: currentFloor, position: { x: result.x, y: camera.position.y, z: result.z }, blockedX: result.blockedX, blockedZ: result.blockedZ });
    }
  }

  function resize(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    if (disposed) return;
    exit();
    disposed = true;
    if (listenersAttached) {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearInput);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      document.removeEventListener('visibilitychange', visibilityChange);
      document.removeEventListener('focusin', focusChange);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('lostpointercapture', pointerEnd);
    }
    if (previousTabIndex === null) canvas.removeAttribute('tabindex');
    else canvas.setAttribute('tabindex', previousTabIndex);
  }

  return {
    camera,
    get active() { return active; },
    get seated() { return seatState !== null; },
    get seatId() { return seatState?.id ?? null; },
    enter, exit, setFloor, setSuspended, sit, stand, update, resize, setMove, look, dispose,
  };
}
