/* Звук. Короткие эффекты (очко, удар) — синтез на WebAudio, без файлов.
   Голоса героя — обычные <audio>, чтобы игра работала и с file://:
     assets/audio/cry.* — голос при ударе, assets/audio/am.* — «ам» на каждый взмах.
   Для каждого голоса браузер берёт сначала .mp3 (своя запись), а если его нет —
   сгенерированный .m4a (tools/make-voices.sh). */
(() => {
  'use strict';

  const KEY = 'face-flappy.muted';
  const load = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const save = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* не страшно */ } };

  let muted = load();
  let ac = null;

  const context = () => {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    return ac;
  };

  /* Первый элемент сам выбирает файл (mp3, иначе m4a). Остальные копии берут уже
     выбранный им адрес, чтобы не стучаться в отсутствующий mp3 по нескольку раз. */
  function voice(name, copies) {
    const first = new Audio();
    first.preload = 'auto';
    [['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4']].forEach(([ext, type]) => {
      const s = document.createElement('source');
      s.src = `assets/audio/${name}.${ext}`;
      s.type = type;
      first.appendChild(s);
    });
    const pool = [first];
    first.addEventListener('loadedmetadata', () => {
      for (let i = 1; i < copies; i++) {
        const a = new Audio(first.currentSrc);
        a.preload = 'auto';
        pool.push(a);
      }
    }, { once: true });
    first.load();
    return pool;
  }

  const cryVoice = voice('cry', 1)[0];
  const am = voice('am', 3);          // несколько копий: взмахи бывают чаще, чем звучит «ам»
  let amNext = 0;

  function play(a, rate) {
    if (muted) return;
    try {
      a.pause();
      a.currentTime = 0;
      a.defaultPlaybackRate = a.playbackRate = rate;
      // Тон меняется вместе со скоростью: выше и быстрее — ближе к детскому плачу.
      a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = false;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* звук необязателен */ }
  }

  /* Браузер разрешает звук только после жеста. Первое нажатие «будит» контекст
     и один раз беззвучно проигрывает плач: на iOS иначе его не запустить в момент
     удара, когда жеста уже нет. «Ам» играет прямо в жесте и в этом не нуждается. */
  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const c = context();
    if (c && c.state === 'suspended') c.resume();
    cryVoice.muted = true;
    const done = () => { cryVoice.pause(); cryVoice.currentTime = 0; cryVoice.muted = false; };
    const p = cryVoice.play();
    if (p && p.then) p.then(done, done); else done();
  }

  function tone(freq, dur, o = {}) {
    const c = context();
    if (!c || muted) return;
    const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    gain.gain.setValueAtTime(o.vol || 0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function noise(dur, vol) {
    const c = context();
    if (!c || muted) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    const gain = c.createGain();
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(gain).connect(c.destination);
    src.start();
  }

  // Плач чуть «дрожит»: плейбэк-рейт качается — тон ходит вверх-вниз, как всхлип.
  let wobble = 0;
  const CRY_RATE = 1.18;
  function cry() {
    play(cryVoice, CRY_RATE);
    cancelAnimationFrame(wobble);
    const t0 = performance.now();
    const tick = () => {
      if (cryVoice.paused || cryVoice.ended) return;
      cryVoice.playbackRate = CRY_RATE + 0.05 * Math.sin((performance.now() - t0) / 1000 * 38);
      wobble = requestAnimationFrame(tick);
    };
    wobble = requestAnimationFrame(tick);
  }

  window.Sound = {
    unlock,
    cry,
    am() {                                   // «ам» с лёгким разбросом тона, чтобы не надоедало
      amNext = (amNext + 1) % am.length;
      play(am[amNext], 0.95 + Math.random() * 0.2);
    },
    score() {
      tone(880, 0.08);
      tone(1320, 0.14, { delay: 0.07 });
    },
    hit() {
      noise(0.16, 0.25);
      tone(190, 0.28, { type: 'sawtooth', to: 50, vol: 0.2 });
    },
    stopCry() {
      cancelAnimationFrame(wobble);
      try { cryVoice.pause(); cryVoice.currentTime = 0; } catch (e) { /* ничего */ }
    },
    toggleMute() {
      muted = !muted;
      save(muted);
      if (muted) { try { cryVoice.pause(); am.forEach((a) => a.pause()); } catch (e) { /* ничего */ } }
      return muted;
    },
    get muted() { return muted; },
  };
})();
