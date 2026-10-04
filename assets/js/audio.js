/* Звук.
   Голоса героя — assets/audio/cry.* (при ударе) и assets/audio/am.* («ам» на взмах).
   Для каждого берётся сначала .mp3 (своя запись), а если его нет — сгенерированный
   .m4a (tools/make-voices.sh).

   Играют они через WebAudio: после того как первое «настоящее» касание разбудило
   контекст, звук идёт в любой момент, хоть в момент удара, когда жеста уже нет.
   На iPhone будить можно только отпусканием пальца (pointerup, touchend, click) —
   pointerdown и touchstart не считаются, поэтому будим по ним, а не по нажатию.
   Если WebAudio недоступен (например, игра открыта двойным кликом, file://),
   голоса играют обычными <audio>. Короткие эффекты (очко, удар) — синтез.

   Музыка — assets/audio/music.m4a (tools/make-music.py), играет по кругу всю игру:
   на заставке громче, в полёте тише, чтобы были слышны голоса. Браузеры не дают включить звук до первого
   касания, поэтому, если сразу нельзя, музыка стартует с касанием. */
(() => {
  'use strict';

  // Версия файлов: меняется вместе со звуками, чтобы встроенные браузеры (Телеграм и др.)
  // не отдавали старые из кеша.
  const VER = '?v=3';

  const KEY = 'face-flappy.muted';
  const load = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const save = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* не страшно */ } };

  let muted = load();
  let ac = null;

  // iOS: без этого беззвучный режим на боковой кнопке глушит и WebAudio.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* не страшно */ }

  const context = () => {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    return ac;
  };
  const running = () => ac && ac.state === 'running';

  // ── Голоса через WebAudio ───────────────────────────────────────────────────
  const buffers = {};

  const decode = (data) => new Promise((res, rej) => {
    // Старый Safari умеет только колбэки, новые — промис; второй вызов resolve безвреден.
    const p = ac.decodeAudioData(data, res, rej);
    if (p && p.then) p.then(res, rej);
  });

  async function loadBuffer(name) {
    if (!context() || !window.fetch) return;
    for (const ext of ['mp3', 'm4a']) {
      try {
        const r = await fetch(`assets/audio/${name}.${ext}${VER}`);
        if (!r.ok) continue;
        buffers[name] = await decode(await r.arrayBuffer());
        return;
      } catch (e) { /* пробуем следующий формат */ }
    }
  }
  const loaded = {};                  // что уже отработало: пригодилось ли запасному пути
  const fetchVoice = (name) => loadBuffer(name).then(() => { loaded[name] = true; startMusic(); });
  fetchVoice('cry');
  fetchVoice('am');

  // Тон меняется вместе со скоростью: выше и быстрее — ближе к детскому голосу.
  // vibrato — дрожание тона, как всхлип.
  function playBuffer(name, rate, vibrato) {
    const buf = buffers[name];
    if (!buf || !running()) return null;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (vibrato) {
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = 0.05;
      lfo.connect(depth).connect(src.playbackRate);
      lfo.start();
      src.onended = () => lfo.stop();
    }
    src.connect(ac.destination);
    src.start();
    return src;
  }

  // ── Запасной путь: обычные <audio> ──────────────────────────────────────────
  /* Первый элемент сам выбирает файл (mp3, иначе m4a). Остальные копии берут уже
     выбранный им адрес, чтобы не стучаться в отсутствующий mp3 по нескольку раз. */
  function voice(name, copies) {
    const first = new Audio();
    first.preload = 'auto';
    [['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4']].forEach(([ext, type]) => {
      const s = document.createElement('source');
      s.src = `assets/audio/${name}.${ext}${VER}`;
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

  function playElement(a, rate) {
    try {
      a.pause();
      a.currentTime = 0;
      a.defaultPlaybackRate = a.playbackRate = rate;
      a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = false;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* звук необязателен */ }
  }

  // ── Разблокировка ───────────────────────────────────────────────────────────
  let elementUnlocked = false;

  function unlock() {
    const c = context();
    if (c && c.state !== 'running') {
      const r = c.resume();
      if (r && r.then) r.then(startMusic, () => {});
      try {                           // тихий буфер: на старых iOS только он включает звук
        const s = c.createBufferSource();
        s.buffer = c.createBuffer(1, 1, 22050);
        s.connect(c.destination);
        s.start(0);
      } catch (e) { /* не страшно */ }
    }
    startMusic();                     // запасному <audio> играть надо прямо в жесте
    // Запасному <audio> нужно один раз беззвучно сыграть плач в жесте, иначе iOS
    // не даст запустить его в момент удара. Если WebAudio загрузил голос — не нужно.
    if (!buffers.cry && !elementUnlocked) {
      elementUnlocked = true;
      cryVoice.muted = true;
      const done = () => { cryVoice.pause(); cryVoice.currentTime = 0; cryVoice.muted = false; };
      const fail = () => { cryVoice.muted = false; elementUnlocked = false; };   // жест был не тот — повторим
      const p = cryVoice.play();
      if (p && p.then) p.then(done, fail); else done();
    }
  }

  ['pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => {
    addEventListener(ev, unlock, { capture: true, passive: true });
  });

  // ── Музыка заставки ─────────────────────────────────────────────────────────
  const MUSIC_VOL = 0.8;              // на заставке
  const MUSIC_VOL_PLAY = 0.35;        // в полёте
  let musicLevel = MUSIC_VOL;
  let wantMusic = false;
  let musicNode = null, musicGain = null, musicEl = null;

  function startMusic() {
    if (!wantMusic || muted || musicNode || (musicEl && !musicEl.paused)) return;
    if (buffers.music) {
      if (!running()) return;         // дождёмся касания: после него сюда вернёмся
      musicGain = ac.createGain();
      musicGain.gain.value = musicLevel;
      musicNode = ac.createBufferSource();
      musicNode.buffer = buffers.music;
      musicNode.loop = true;
      musicNode.connect(musicGain).connect(ac.destination);
      musicNode.start();
    } else if (loaded.music) {        // WebAudio не смог: играем обычным <audio>
      if (!musicEl) {
        musicEl = new Audio('assets/audio/music.m4a' + VER);
        musicEl.loop = true;
      }
      musicEl.volume = musicLevel;
      const p = musicEl.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  function haltMusic(fade) {
    if (musicNode) {
      const node = musicNode, gain = musicGain;
      musicNode = musicGain = null;
      try {
        const t = ac.currentTime;
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fade);
        node.stop(t + fade + 0.05);
      } catch (e) { /* уже стоит */ }
    }
    if (musicEl) musicEl.pause();
  }

  // ── Эффекты ─────────────────────────────────────────────────────────────────
  function tone(freq, dur, o = {}) {
    if (!running() || muted) return;
    const t = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    gain.gain.setValueAtTime(o.vol || 0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function noise(dur, vol) {
    if (!running() || muted) return;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(gain).connect(ac.destination);
    src.start();
  }

  // ── Голоса героя ────────────────────────────────────────────────────────────
  const CRY_RATE = 1.18;
  let cryNode = null;
  let wobble = 0;

  function stopCry() {
    cancelAnimationFrame(wobble);
    if (cryNode) { try { cryNode.stop(); } catch (e) { /* уже стоит */ } cryNode = null; }
    try { cryVoice.pause(); cryVoice.currentTime = 0; } catch (e) { /* ничего */ }
  }

  function cry() {
    if (muted) return;
    stopCry();
    cryNode = playBuffer('cry', CRY_RATE, true);
    if (cryNode) return;
    // Запасной путь: тон «дрожит» через playbackRate элемента.
    playElement(cryVoice, CRY_RATE);
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
    stopCry,
    am() {                                   // «ам» с лёгким разбросом тона, чтобы не надоедало
      if (muted) return;
      const rate = 0.95 + Math.random() * 0.2;
      if (playBuffer('am', rate)) return;
      amNext = (amNext + 1) % am.length;
      playElement(am[amNext], rate);
    },
    score() {
      tone(880, 0.08);
      tone(1320, 0.14, { delay: 0.07 });
    },
    hit() {
      noise(0.16, 0.25);
      tone(190, 0.28, { type: 'sawtooth', to: 50, vol: 0.2 });
    },
    // on = true: музыка должна играть (стартует, как только браузер позволит);
    // false: плавно затихает и больше не включается.
    music(on) {
      wantMusic = on;
      if (on && !('music' in loaded)) { loaded.music = false; fetchVoice('music'); }   // грузим, только если музыка включена
      if (on) startMusic(); else haltMusic(0.5);
    },
    // Громкость музыки: true — тише (идёт игра), false — как на заставке.
    duck(on) {
      musicLevel = on ? MUSIC_VOL_PLAY : MUSIC_VOL;
      if (musicNode) {
        const t = ac.currentTime;
        musicGain.gain.setValueAtTime(musicGain.gain.value, t);
        musicGain.gain.linearRampToValueAtTime(musicLevel, t + 0.6);
      }
      if (musicEl) musicEl.volume = musicLevel;
    },
    toggleMute() {
      muted = !muted;
      save(muted);
      if (muted) { stopCry(); haltMusic(0.1); try { am.forEach((a) => a.pause()); } catch (e) { /* ничего */ } }
      else startMusic();
      return muted;
    },
    get muted() { return muted; },
    // Для отладки из консоли: состояние контекста и какие голоса загружены.
    info() {
      return {
        context: ac ? ac.state : 'нет', buffers: Object.keys(buffers),
        music: !!musicNode || !!(musicEl && !musicEl.paused),
      };
    },
  };
})();
