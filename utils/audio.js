// 统一游戏音频控制：BGM 使用本地 MP3，操作音效使用 Web Audio 合成。
(function (global) {
  'use strict';

  const STORAGE_KEY = 'spider_save';
  const DEFAULTS = { musicVolume: 28, sfxVolume: 100 };
  let media = null;
  let fadeTimer = null;
  let audioContext = null;
  let sfxGain = null;
  let settings = Object.assign({}, DEFAULTS);

  function readStoredSettings() {
    try {
      const data = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '{}');
      const saved = data.settings || {};
      // 兼容旧版本的 volume/sound 字段，之后统一使用两个独立字段。
      const musicVolume = saved.musicVolume === undefined
        ? (saved.volume === undefined ? DEFAULTS.musicVolume : saved.volume)
        : saved.musicVolume;
      const sfxVolume = saved.sfxVolume === undefined
        ? (saved.sound === undefined ? DEFAULTS.sfxVolume : (saved.sound ? DEFAULTS.sfxVolume : 0))
        : saved.sfxVolume;
      return { musicVolume: clamp(musicVolume), sfxVolume: clamp(sfxVolume) };
    } catch (_) { return Object.assign({}, DEFAULTS); }
  }

  function clamp(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }

  function ensureMedia() {
    if (media) return true;
    try {
      media = new global.Audio('./audio/cheerful-march.mp3');
      media.loop = true;
      media.preload = 'auto';
      media.playbackRate = 0.85;
      media.volume = 0;
      media.setAttribute('playsinline', '');
      return true;
    } catch (_) { media = null; return false; }
  }

  function ensureContext() {
    if (audioContext) {
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return true;
    }
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return false;
    try {
      audioContext = new Ctx();
      sfxGain = audioContext.createGain();
      sfxGain.connect(audioContext.destination);
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      applySfxGain();
      return true;
    } catch (_) { audioContext = null; sfxGain = null; return false; }
  }

  function applySfxGain() {
    if (!sfxGain || !audioContext) return;
    const value = settings.sfxVolume / 100;
    sfxGain.gain.setTargetAtTime(value > 0 ? value : 0.0001, audioContext.currentTime, 0.04);
  }

  function fadeMusicTo(target, duration, done) {
    if (!media) { if (done) done(); return; }
    if (fadeTimer) global.clearInterval(fadeTimer);
    const from = media.volume;
    const started = Date.now();
    fadeTimer = global.setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / Math.max(1, duration));
      media.volume = from + (target - from) * progress;
      if (progress >= 1) {
        global.clearInterval(fadeTimer); fadeTimer = null;
        if (done) done();
      }
    }, 24);
  }

  function startMusic() {
    if (!ensureMedia() || settings.musicVolume <= 0) return;
    const target = settings.musicVolume / 100;
    media.playbackRate = 0.85;
    const promise = media.play();
    if (promise && promise.catch) promise.catch(() => {});
    fadeMusicTo(target, 700);
  }

  function stopMusic() {
    if (!ensureMedia()) return;
    fadeMusicTo(0, 380, () => { try { media.pause(); } catch (_) {} });
  }

  function sync(next) {
    settings = Object.assign(settings, next || {});
    settings.musicVolume = clamp(settings.musicVolume === undefined ? DEFAULTS.musicVolume : settings.musicVolume);
    settings.sfxVolume = clamp(settings.sfxVolume === undefined ? DEFAULTS.sfxVolume : settings.sfxVolume);
    ensureMedia();
    ensureContext();
    applySfxGain();
    if (media) {
      if (settings.musicVolume > 0) {
        if (media.paused) startMusic();
        else fadeMusicTo(settings.musicVolume / 100, 220);
      } else stopMusic();
    }
  }

  function tone(freq, duration, when, level, type) {
    if (!ensureContext()) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), when + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain); gain.connect(sfxGain);
    osc.start(when); osc.stop(when + duration + 0.04);
  }

  function play(name) {
    if (settings.sfxVolume <= 0 || !ensureContext()) return;
    const now = audioContext.currentTime;
    if (name === 'move') { tone(440, .07, now, .22); tone(554.37, .09, now + .055, .18); }
    else if (name === 'draw') { tone(392, .08, now, .24, 'triangle'); tone(523.25, .13, now + .07, .22, 'triangle'); }
    else if (name === 'place') { tone(523.25, .08, now, .25); tone(659.25, .16, now + .06, .22); }
    else if (name === 'success') [523.25, 659.25, 783.99].forEach((f, i) => tone(f, .2, now + i * .09, .24));
    else if (name === 'error') { tone(180, .18, now, .25, 'sawtooth'); tone(140, .2, now + .08, .2, 'sawtooth'); }
    else if (name === 'shuffle') [330, 392, 466, 554].forEach((f, i) => tone(f, .07, now + i * .045, .2, 'triangle'));
    else if (name === 'click') tone(660, .045, now, .14);
  }

  function bindGesture() {
    const wake = () => { ensureMedia(); ensureContext(); startMusic(); };
    ['pointerdown', 'touchstart', 'click'].forEach(type => global.document.addEventListener(type, wake, { passive: true }));
  }

  settings = readStoredSettings();
  ensureMedia();
  global.GameAudio = { sync, startMusic, stopMusic, play, bindGesture, getSettings: () => Object.assign({}, settings) };
})(window);
