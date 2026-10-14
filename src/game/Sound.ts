// Простые звуки, сгенерированные через Web Audio API (без звуковых файлов). Есть кнопка «звук вкл/выкл».

const SOUND_KEY = 'factory-game-sound';

let ctx: AudioContext | null = null;
let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundOn(): boolean {
  return enabled;
}

export function toggleSound(): boolean {
  enabled = !enabled;
  try {
    localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  } catch {
    // нет доступа к хранилищу — настройка просто не запомнится
  }
  return enabled;
}

/** Один короткий тон. delay — задержка в секундах (для арпеджио). */
function tone(freq: number, duration: number, type: OscillatorType, volume: number, delay = 0): void {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch {
    // Web Audio недоступен — играем без звука
  }
}

export const Sound = {
  place: () => tone(520, 0.08, 'square', 0.04),
  remove: () => tone(200, 0.1, 'triangle', 0.06),
  error: () => tone(140, 0.12, 'sawtooth', 0.03),
  click: () => tone(760, 0.05, 'sine', 0.05),
  goal: () => [523, 659, 784].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, i * 0.08)),
  levelUp: () => [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, i * 0.07)),
  unlock: () => [659, 880].forEach((f, i) => tone(f, 0.2, 'sine', 0.08, i * 0.1)),
};
