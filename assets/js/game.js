/* Глобус — Flappy. Холст 144×256, всё рисуется в пикселях. Без зависимостей. */
(() => {
  'use strict';

  // ── Настройки ───────────────────────────────────────────────────────────────
  const TITLE = 'ГЛОБУС';
  const ASK = ['НУ ЧТО,', 'ХУЙ,', 'ПОИГРАЕМ?'];   // вопрос в меню, по строкам
  const FAIL = 'ЕБАНЫЙ В РОТ';                    // что кричит лицо при ударе

  const W = 144, H = 256;
  const GROUND_H = 32, GROUND_Y = H - GROUND_H;

  // Баланс. Единицы — пиксели игры и секунды.
  const GRAVITY = 950, FLAP_V = -230, MAX_FALL = 380;   // взмах поднимает лицо на ≈28 px
  const SPEED = 60;                 // скорость мира
  const GAP = 86;                   // просвет: свободный зазор ≈2 подъёмов взмаха
  const SPACING = 92;               // расстояние между трубами по горизонтали
  const MARGIN = 30;                // минимум видимой трубы сверху и снизу
  const MAX_SHIFT = 54;             // на сколько просвет может уехать относительно прошлого

  const FACE_X = 40;
  // Хитбокс — два круга по форме головы (череп и челюсть), уже спрайта: ушей и края
  // волос не касаемся. Смещение и радиус — доли высоты спрайта, от его центра.
  const HIT = [{ y: -0.14, r: 0.26 }, { y: 0.17, r: 0.23 }];
  const OPEN = 0.26;                // максимум раскрытия рта — доля высоты головы

  // Размеры спрайта трубы — те же, что в tools/pixelate.py.
  const PIPE_W = 27, CAP_W = 31, CAP_H = 22, TILE_H = 16;
  const CAP_OFF = (CAP_W - PIPE_W) / 2;   // на сколько шапка выступает за ствол с каждой стороны
  const DOME_R = CAP_W / 2;               // шапка — полукруг этого радиуса, плюс прямой пояс под ним
  const DOME_ROWS = Math.ceil(DOME_R);

  const STEP = 1 / 60;
  const CHOMP_FRAMES = 14;          // сколько кадров рот открыт после взмаха
  const OVER_AFTER = 50;            // через сколько кадров после удара показать счёт
  const RESTART_AFTER = 40;         // и через сколько кадров после этого можно рестартовать

  const MENU_FACE_Y = 156;          // высота лица в меню: под вопросом, над кнопкой
  const YES = { x: 40, y: 188, w: 64, h: 26 };   // кнопка «ДА»

  const INK = '#2a1d33';
  const SKY = ['#3b82d6', '#4c93e0', '#63a7ea', '#81bcf0', '#a5d1f5'];
  const BEST_KEY = 'face-flappy.best';

  const DEFAULT_EYES = [{ x: 0.32, y: 0.42 }, { x: 0.68, y: 0.42 }];
  const DEFAULT_MOUTH = { x: 0.5, y: 0.74 };

  // ── Мелочи ──────────────────────────────────────────────────────────────────
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };
  const loadImage = (src) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
  const readBest = () => { try { return +localStorage.getItem(BEST_KEY) || 0; } catch (e) { return 0; } };
  const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* не страшно */ } };

  const screen = document.getElementById('game');
  const sg = screen.getContext('2d');
  const lo = canvas(W, H);            // сюда рисуем в «родном» разрешении, потом растягиваем
  const g = lo.getContext('2d');
  g.imageSmoothingEnabled = false;    // иначе поворот лица размывает пиксели
  let scale = 1;

  // ── Заглушки спрайтов ───────────────────────────────────────────────────────
  // Игра запускается и без фото: смайлик и розовая труба рисуются кодом.
  // Настоящие спрайты кладёт tools/pixelate.py (манифест assets/js/sprites.js).

  function smiley() {
    const S = 24;
    const c = canvas(S, S), x = c.getContext('2d'), r = S / 2;
    for (let y = 0; y < S; y++) for (let px = 0; px < S; px++) {
      const d = Math.hypot(px + .5 - r, y + .5 - r);
      if (d > r - .4) continue;
      x.fillStyle = d > r - 1.4 ? INK : '#ffd34d';
      x.fillRect(px, y, 1, 1);
    }
    x.fillStyle = INK;
    x.fillRect(7, 9, 2, 3); x.fillRect(15, 9, 2, 3); x.fillRect(8, 16, 8, 1);
    return x.canvas;
  }

  // Розовая труба: гладкий ствол без полос и большая круглая шапка-полукруг с
  // чёрточкой по центру. Раскладка атласа: шапка 31×22 сверху, под ней тайл 27×16.
  // Тот же формат у спрайтов tools/pixelate.py.
  function pipeAtlas() {
    const c = canvas(CAP_W, CAP_H + TILE_H), x = c.getContext('2d');
    const OUT = '#5b2139';
    const PINK = { base: '#f4a3b5', hi: '#ffd1dc', shade: '#e07c96', dark: '#b85572' };
    const tone = (t) => t < .10 ? PINK.base : t < .30 ? PINK.hi : t < .58 ? PINK.base : t < .82 ? PINK.shade : PINK.dark;
    const dot = (px, py, col) => { x.fillStyle = col; x.fillRect(px, py, 1, 1); };

    // Ствол: только вертикальное «цилиндрическое» затенение, по бокам контур.
    for (let y = 0; y < TILE_H; y++) for (let px = 0; px < PIPE_W; px++) {
      dot(CAP_OFF + px, CAP_H + y, px === 0 || px === PIPE_W - 1 ? OUT : tone(px / (PIPE_W - 1)));
    }

    // Шапка: полукруг сверху, ниже прямой пояс, снизу контур.
    const inside = (px, py) => px >= 0 && px < CAP_W && py >= 0 && py < CAP_H
      && (py >= DOME_ROWS || (px + .5 - DOME_R) ** 2 + (py + .5 - DOME_R) ** 2 <= DOME_R * DOME_R);
    for (let y = 0; y < CAP_H; y++) for (let px = 0; px < CAP_W; px++) {
      if (!inside(px, y)) continue;
      const edge = !inside(px - 1, y) || !inside(px + 1, y) || !inside(px, y - 1) || !inside(px, y + 1);
      dot(px, y, edge ? OUT : tone(px / (CAP_W - 1)));
    }
    [[8, 6], [8, 5], [9, 4], [10, 3], [11, 3]].forEach(([px, py]) => dot(px, py, '#fff0f4'));   // блик
    for (let y = 4; y <= 10; y++) dot(Math.floor(CAP_W / 2), y, OUT);                          // чёрточка по центру
    return c;
  }

  // ── Состояние ───────────────────────────────────────────────────────────────
  let faceSprite, crySprite, faceWhite, faceDef, pipeSprites;
  let FW = 24, FH = 24;               // размер спрайта головы, берётся из картинки
  let hit = [];                       // круги хитбокса в пикселях
  let state, t, score, best, newBest;
  let face, pipes, tears, lastGy;
  let groundX, cloudX, cityX;
  let shake, flash, dieT, overT, popT;
  let bubbleT;

  function reset() {
    state = 'ready';
    t = 0; score = 0; newBest = false;
    face = { x: FACE_X, y: 118, base: 118, vy: 0, rot: 0, chomp: 0, onGround: false };
    pipes = [];
    tears = [];
    lastGy = GROUND_Y / 2;
    shake = flash = dieT = overT = popT = 0;
    bubbleT = 0;
    Sound.stopCry();
  }

  // ── Игра ────────────────────────────────────────────────────────────────────
  function flap() {
    face.vy = FLAP_V;
    face.chomp = CHOMP_FRAMES;
    Sound.am();
  }

  function press() {
    Sound.unlock();
    if (state === 'menu') { state = 'ready'; t = 0; }
    else if (state === 'ready') { state = 'play'; Sound.duck(true); flap(); }
    else if (state === 'play') flap();
    else if (state === 'over' && overT > RESTART_AFTER) reset();
  }

  function spawnPipe(x) {
    const lo_ = MARGIN + GAP / 2, hi_ = GROUND_Y - MARGIN - GAP / 2;
    const gy = clamp(lastGy + rand(-MAX_SHIFT, MAX_SHIFT), lo_, hi_);
    lastGy = gy;
    pipes.push({ x, gy, scored: false, s: Math.floor(Math.random() * pipeSprites.length) });
  }

  function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw), ny = clamp(cy, ry, ry + rh);
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  function hitsPipe(p) {
    const top = p.gy - GAP / 2, bot = p.gy + GAP / 2;
    const rects = [
      [p.x, -300, PIPE_W, top - CAP_H + 300],                        // верхний ствол
      [p.x - CAP_OFF, top - CAP_H, CAP_W, CAP_H - DOME_ROWS],         // верхняя шапка, прямой пояс
      [p.x - CAP_OFF, bot + DOME_ROWS, CAP_W, CAP_H - DOME_ROWS],     // нижняя шапка, прямой пояс
      [p.x, bot + CAP_H, PIPE_W, GROUND_Y - bot - CAP_H],            // нижний ствол
    ];
    const cx = p.x + PIPE_W / 2;
    const domes = [top - DOME_R, bot + DOME_R];                      // центры кругов-куполов по высоте
    return hit.some((c) => {
      const cy = face.y + c.y;
      return rects.some(([x, y, w, h]) => circleHitsRect(face.x, cy, c.r, x, y, w, h))
        || domes.some((dy) => Math.hypot(face.x - cx, cy - dy) < c.r + DOME_R - 1);   // −1: край купола прощаем
    });
  }

  // Рот открывается до OPEN высоты головы; челюсть уезжает вниз, поэтому на земле
  // лицу нужен запас — полраскрытия.
  const maxOpen = () => Math.round(FH * OPEN);
  const restY = () => GROUND_Y - FH / 2 - Math.ceil(maxOpen() / 2) + 1;

  function die(onGround) {
    state = 'dying';
    dieT = 0;
    flash = 3;
    shake = 14;
    face.onGround = onGround;
    face.vy = onGround ? 0 : -90;                   // от трубы лицо чуть подпрыгивает и падает
    if (onGround) face.y = restY();
    if (score > best) { best = score; newBest = true; writeBest(best); }
    Sound.hit();
    Sound.cry();
    if (navigator.vibrate) navigator.vibrate(180);
  }

  // Слёзы бьют двумя фонтанами из позиций глаз, с учётом наклона лица.
  function eyePoints() {
    const pts = faceDef.eyes.map((e) => [e.x * FW - FW / 2, e.y * FH - FH / 2 + 2]);
    const c = Math.cos(face.rot), s = Math.sin(face.rot);
    return pts.map(([lx, ly]) => [face.x + lx * c - ly * s, face.y + lx * s + ly * c]);
  }

  function spawnTears() {
    eyePoints().forEach(([x, y], i) => {
      const dir = i === 0 ? -1 : 1;
      const n = dieT < 100 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        tears.push({
          x, y, vx: dir * rand(14, 55), vy: -rand(25, 95), life: rand(0.7, 1.2),
          c: Math.random() < 0.3 ? '#ffffff' : '#79d2ff',
          w: Math.random() < 0.4 ? 2 : 1,
        });
      }
    });
  }

  function stepTears() {
    for (const p of tears) {
      p.vy += 420 * STEP;
      p.x += p.vx * STEP;
      p.y += p.vy * STEP;
      p.life -= STEP;
    }
    tears = tears.filter((p) => p.life > 0 && p.y < GROUND_Y);
  }

  function autopilot() {
    const p = pipes.find((q) => q.x + CAP_W > face.x - hit[0].r);
    const bottom = hit[1].y + hit[1].r;             // низ хитбокса от центра
    const target = (p ? p.gy : 118) + GAP / 2 - bottom - 8;   // взмахиваем чуть выше нижней границы просвета
    if (face.vy > 40 && face.y > target) flap();
  }

  function stepWorld() {
    groundX += SPEED * STEP;
    cloudX += 8 * STEP;
    cityX += 20 * STEP;
  }

  function update() {
    t++;
    if (flash > 0) flash--;
    if (shake > 0) shake--;
    if (face.chomp > 0) face.chomp--;
    if (popT > 0) popT--;

    if (state === 'menu' || state === 'ready') {
      stepWorld();
      face.base += ((state === 'menu' ? MENU_FACE_Y : 118) - face.base) * 0.15;
      face.y = face.base + Math.sin(t * 0.09) * 4;
      face.rot = Math.sin(t * 0.09) * 0.05;
      return;
    }

    if (state === 'play') {
      if (window.__bot) autopilot();
      stepWorld();
      face.vy = Math.min(face.vy + GRAVITY * STEP, MAX_FALL);
      face.y += face.vy * STEP;
      face.rot += (clamp(face.vy * 0.0022, -0.3, 0.55) - face.rot) * 0.25;   // наклон небольшой: пиксели при повороте рвутся
      const ceil = -(hit[0].y - hit[0].r);          // верх черепа не уходит за экран
      if (face.y < ceil) { face.y = ceil; face.vy = Math.max(face.vy, 0); }

      const next = pipes.length ? pipes[pipes.length - 1].x + SPACING : W + 20;
      if (next < W + CAP_W) spawnPipe(next);
      for (const p of pipes) {
        p.x -= SPEED * STEP;
        if (!p.scored && p.x + PIPE_W < face.x) {
          p.scored = true; score++; popT = 8; Sound.score();
        }
      }
      if (pipes.length && pipes[0].x < -CAP_W) pipes.shift();

      if (face.y + FH / 2 - 1 >= GROUND_Y) die(true);
      else if (pipes.some(hitsPipe)) die(false);
      return;
    }

    // dying и over: мир стоит, лицо падает и ревёт.
    dieT++;
    if (!face.onGround) {
      face.vy = Math.min(face.vy + GRAVITY * STEP, MAX_FALL);
      face.y += face.vy * STEP;
      face.rot += (0.55 - face.rot) * 0.08;
      if (face.y >= restY()) {
        face.y = restY(); face.onGround = true; face.vy = 0;
        shake = Math.max(shake, 6);
      }
    } else {
      face.rot += (0.12 - face.rot) * 0.15;
    }
    if (dieT < 150 && dieT > 3) spawnTears();
    stepTears();
    if (dieT >= 4) bubbleT++;
    if (state === 'dying' && dieT >= OVER_AFTER) state = 'over';
    if (state === 'over') overT++;
  }

  // ── Отрисовка: фон ──────────────────────────────────────────────────────────
  const city = (() => {
    const c = canvas(W, 60), x = c.getContext('2d');
    let bx = 0;
    while (bx < W) {
      const bw = Math.min(10 + Math.floor(Math.random() * 14), W - bx);
      const bh = 14 + Math.floor(Math.random() * 40);
      x.fillStyle = '#6c9fd8';
      x.fillRect(bx, 60 - bh, bw, bh);
      x.fillStyle = '#86b3e6';
      for (let wy = 60 - bh + 4; wy < 56; wy += 6) for (let wx = bx + 2; wx < bx + bw - 2; wx += 4) x.fillRect(wx, wy, 2, 2);
      bx += bw;
    }
    return c;
  })();

  const cloud = (() => {
    const c = canvas(34, 14), x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    [[6, 5, 22, 7], [2, 8, 30, 4], [10, 1, 12, 7], [17, 3, 11, 5]].forEach((r) => x.fillRect(...r));
    x.fillStyle = '#d8eafb';
    x.fillRect(3, 11, 28, 1);
    return c;
  })();
  const CLOUDS = [[10, 30], [70, 62], [120, 22], [40, 100], [100, 120]];

  function drawBackground() {
    SKY.forEach((col, i) => {
      g.fillStyle = col;
      const y0 = Math.round(i * GROUND_Y / SKY.length), y1 = Math.round((i + 1) * GROUND_Y / SKY.length);
      g.fillRect(0, y0, W, y1 - y0);
    });
    const co = Math.floor(cloudX) % W;
    for (const [x, y] of CLOUDS) {
      for (const dx of [-W, 0]) g.drawImage(cloud, ((x - co) % W + W) % W + dx, y);
    }
    const ci = Math.floor(cityX) % W;
    g.drawImage(city, -ci, GROUND_Y - 60);
    g.drawImage(city, W - ci, GROUND_Y - 60);
  }

  function drawGround() {
    g.fillStyle = '#ded895';
    g.fillRect(0, GROUND_Y, W, GROUND_H);
    const n = Math.floor(groundX / 8), o = Math.floor(groundX) % 8;
    for (let i = 0; i <= W / 8 + 1; i++) {
      g.fillStyle = (i + n) & 1 ? '#74c02f' : '#9de24f';
      g.fillRect(i * 8 - o, GROUND_Y + 1, 8, 5);
    }
    g.fillStyle = INK;
    g.fillRect(0, GROUND_Y, W, 1);
    g.fillStyle = '#c4b26a';
    g.fillRect(0, GROUND_Y + 6, W, 1);
    g.fillStyle = '#d3c37c';
    for (let x = -o; x < W; x += 16) g.fillRect(x, GROUND_Y + 14, 6, 2);
  }

  // ── Отрисовка: трубы ────────────────────────────────────────────────────────
  function tileBody(atlas, x, y, len) {
    for (let o = 0; o < len; o += TILE_H) {
      const h = Math.min(TILE_H, len - o);
      g.drawImage(atlas, CAP_OFF, CAP_H, PIPE_W, h, x, y + o, PIPE_W, h);
    }
  }

  function drawPipe(p) {
    const atlas = pipeSprites[p.s];
    const x = Math.round(p.x);
    const top = Math.round(p.gy - GAP / 2), bot = Math.round(p.gy + GAP / 2);
    g.drawImage(atlas, 0, 0, CAP_W, CAP_H, x - CAP_OFF, bot, CAP_W, CAP_H);
    tileBody(atlas, x, bot + CAP_H, GROUND_Y - bot - CAP_H);
    g.save();                                       // верхняя труба — та же, но вверх ногами
    g.translate(0, top);
    g.scale(1, -1);
    g.drawImage(atlas, 0, 0, CAP_W, CAP_H, x - CAP_OFF, 0, CAP_W, CAP_H);
    tileBody(atlas, x, CAP_H, top - CAP_H);
    g.restore();
  }

  // ── Отрисовка: лицо ─────────────────────────────────────────────────────────
  // Рот, открытый по-настоящему: голова режется по линии губ, череп уезжает вверх,
  // челюсть вниз, щёки тянутся, а в проёме видны зубы и язык.
  function openMouth(mx, gy, d) {
    const hw = Math.round(FW * 0.22);
    const x = mx - hw, w = hw * 2 + 1;
    g.fillStyle = INK;                              // контур рта
    g.fillRect(x - 1, gy - 1, w + 2, d + 2);
    g.fillStyle = '#5a1226';                        // нутро
    g.fillRect(x, gy, w, d);
    const th = d >= 5 ? 2 : 1;
    const lower = d >= 7;
    g.fillStyle = '#ffffff';                        // верхние и нижние зубы
    g.fillRect(x + 1, gy, w - 2, th);
    if (lower) g.fillRect(x + 1, gy + d - th, w - 2, th);
    g.fillStyle = '#bdb4b8';                        // щели между зубами
    for (let tx = x + 3; tx < x + w - 2; tx += 3) {
      g.fillRect(tx, gy, 1, th);
      if (lower) g.fillRect(tx, gy + d - th, 1, th);
    }
    if (d >= 6) {                                   // язык
      g.fillStyle = '#e0566a';
      g.fillRect(mx - 2, gy + d - (lower ? th : 0) - 2, 5, 2);
    }
    g.fillStyle = INK;                              // скруглённые углы рта
    g.fillRect(x, gy, 1, 1); g.fillRect(x + w - 1, gy, 1, 1);
    g.fillRect(x, gy + d - 1, 1, 1); g.fillRect(x + w - 1, gy + d - 1, 1, 1);
  }

  // Голова с отвисшей на d пикселей челюстью. Возвращает, на сколько уехал вверх череп.
  function drawHead(spr, d) {
    const x0 = -Math.round(FW / 2), y0 = -Math.round(FH / 2);
    if (d <= 0) { g.drawImage(spr, x0, y0, FW, FH); return 0; }
    const my = clamp(Math.round(faceDef.mouth.y * FH), 6, FH - 6);
    const mx = Math.round(faceDef.mouth.x * FW) + x0;
    const up = d >> 1;
    const gy = y0 - up + my;                        // верх проёма
    g.drawImage(spr, 0, 0, FW, my, x0, y0 - up, FW, my);                  // череп
    g.drawImage(spr, 0, my - 2, FW, 1, x0, gy, FW, d);                    // щёки растянуты
    g.drawImage(spr, 0, my, FW, FH - my, x0, gy + d, FW, FH - my);        // челюсть
    openMouth(mx, gy, d);
    return up;
  }

  function squeezeEyes(up) {
    const eyes = faceDef.eyes.map((e) => ({
      x: Math.round(e.x * FW - FW / 2), y: Math.round(e.y * FH - FH / 2) - up,
    }));
    g.fillStyle = INK;                              // зажмуренные глаза
    eyes.forEach((e) => g.fillRect(e.x - 2, e.y, 5, 2));
    eyes.forEach((e, k) => {                        // брови домиком: внутренние концы выше
      for (let i = 0; i < 5; i++) {
        const inner = k === 0 ? i : 4 - i;
        g.fillRect(e.x - 2 + i, e.y - 3 - Math.round(inner / 2), 1, 1);
      }
    });
    g.fillStyle = 'rgba(255, 70, 90, 0.55)';        // румянец от рёва
    g.fillRect(eyes[0].x - 4, eyes[0].y + 3, 3, 2);
    g.fillRect(eyes[1].x + 2, eyes[1].y + 3, 3, 2);
  }

  function drawFace() {
    const crying = state === 'dying' || state === 'over';
    const ownCry = crying && crySprite;             // есть отдельное фото плачущего лица
    const sob = crying && dieT > 6 && dieT < 160 && face.onGround ? (t & 2 ? 1 : 0) : 0;
    let d = 0;
    if (flash > 0 || ownCry) d = 0;
    else if (crying) d = Math.round(maxOpen() * (0.8 + 0.2 * Math.sin(t * 0.7)));
    else if (face.chomp > 0) {
      const p = face.chomp / CHOMP_FRAMES;          // открывается мгновенно, держится, закрывается плавно
      d = Math.round(maxOpen() * (p > 0.65 ? 1 : p / 0.65));
    }
    g.save();
    g.translate(Math.round(face.x), Math.round(face.y) + sob);
    g.rotate(face.rot);
    const up = drawHead(flash > 0 ? faceWhite : ownCry ? crySprite : faceSprite, d);
    if (crying && !ownCry && flash === 0) squeezeEyes(up);
    g.restore();
  }

  function drawTears() {
    for (const p of tears) {
      g.fillStyle = p.c;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.w, p.vy > 0 ? p.w + 1 : p.w);
    }
  }

  function drawBubble() {
    if (bubbleT === 0 || dieT > 130) return;
    const text = FAIL;
    const w = Font.measure(text) + 8, h = 13;
    const wob = Math.round(Math.sin(t * 0.5));
    const pop = bubbleT < 4 ? bubbleT / 4 : 1;      // «выскакивает» за пару кадров
    const bw = Math.round(w * pop), bh = Math.round(h * pop);
    const bx = clamp(Math.round(face.x - w / 2), 3, W - w - 3);
    const by = Math.round(face.y - FH / 2 - 12 - h) + wob;
    g.fillStyle = INK;
    g.fillRect(bx - 1 + (w - bw) / 2, by - 1 + (h - bh), bw + 2, bh + 2);
    g.fillStyle = '#ffffff';
    g.fillRect(bx + (w - bw) / 2, by + (h - bh), bw, bh);
    if (pop < 1) return;
    const tx = clamp(Math.round(face.x), bx + 4, bx + w - 8);   // хвостик к лицу
    g.fillStyle = INK; g.fillRect(tx - 1, by + h + 1, 5, 1); g.fillRect(tx, by + h + 2, 3, 1); g.fillRect(tx + 1, by + h + 3, 1, 1);
    g.fillStyle = '#ffffff'; g.fillRect(tx, by + h, 3, 1); g.fillRect(tx + 1, by + h + 1, 1, 1);
    Font.draw(g, text, bx + w / 2 + 1, by + 3, { color: '#c8322f', align: 'center' });
  }

  // ── Отрисовка: интерфейс ────────────────────────────────────────────────────
  const OUTLINE_TEXT = { edge: INK };

  function drawSpeaker() {
    const x = W - 14, y = 5;
    g.fillStyle = INK;
    g.fillRect(x - 1, y + 1, 4, 5); g.fillRect(x + 3, y, 1, 7); g.fillRect(x + 4, y - 1, 1, 9);
    g.fillStyle = '#ffffff';
    g.fillRect(x, y + 2, 2, 3); g.fillRect(x + 2, y + 1, 1, 5); g.fillRect(x + 3, y + 1, 1, 5);
    if (Sound.muted) {
      g.fillStyle = '#ff4d5e';
      for (let i = 0; i < 5; i++) { g.fillRect(x + 6 + i, y + 1 + i, 1, 1); g.fillRect(x + 10 - i, y + 1 + i, 1, 1); }
    } else {
      g.fillStyle = INK;
      g.fillRect(x + 6, y + 2, 1, 3); g.fillRect(x + 8, y, 1, 7);
    }
  }

  function drawMenu() {
    Font.draw(g, TITLE, W / 2, 20, { scale: 3, align: 'center', color: '#ffd34d', ...OUTLINE_TEXT });
    ASK.forEach((line, i) => {
      Font.draw(g, line, W / 2, 62 + i * 18, { scale: 2, align: 'center', color: '#ffffff', ...OUTLINE_TEXT });
    });
    const b = YES, y = b.y + ((t >> 4) & 1);        // кнопка слегка «дышит»
    g.fillStyle = INK; g.fillRect(b.x - 2, y - 2, b.w + 4, b.h + 4);
    g.fillStyle = '#4a8a1c'; g.fillRect(b.x, y, b.w, b.h);
    g.fillStyle = '#74c02f'; g.fillRect(b.x, y, b.w, b.h - 3);
    g.fillStyle = '#9de24f'; g.fillRect(b.x, y, b.w, 2);
    Font.draw(g, 'ДА', W / 2, y + 5, { scale: 2, align: 'center', color: '#ffffff', ...OUTLINE_TEXT });
  }

  function drawReady() {
    Font.draw(g, TITLE, W / 2, 40, { scale: 3, align: 'center', color: '#ffd34d', ...OUTLINE_TEXT });
    if ((t >> 5) & 1 || t < 32) {
      Font.draw(g, 'НАЖМИ', W / 2, 160, { scale: 2, align: 'center', color: '#ffffff', ...OUTLINE_TEXT });
    }
    Font.draw(g, 'ПРОБЕЛ ИЛИ ТАП', W / 2, 184, { align: 'center', color: '#ffffff', ...OUTLINE_TEXT });
  }

  function drawScore() {
    const s = popT > 0 ? 3 : 2;
    Font.draw(g, String(score), W / 2, 14, { scale: s, align: 'center', color: '#ffffff', ...OUTLINE_TEXT });
  }

  function drawOver() {
    const slide = Math.max(0, 36 - overT * 4);
    const x = 22, y = 64 + slide, w = W - 44, h = 70;
    g.fillStyle = INK; g.fillRect(x - 2, y - 2, w + 4, h + 4);
    g.fillStyle = '#ded895'; g.fillRect(x, y, w, h);
    g.fillStyle = '#c4b26a'; g.fillRect(x, y + h - 3, w, 3);
    Font.draw(g, 'СЧЁТ', W / 2, y + 8, { align: 'center', color: '#c8322f' });
    Font.draw(g, String(score), W / 2, y + 19, { scale: 2, align: 'center', color: INK });
    Font.draw(g, 'РЕКОРД', W / 2, y + 40, { align: 'center', color: '#c8322f' });
    Font.draw(g, String(best), W / 2, y + 51, { scale: 2, align: 'center', color: INK });
    if (newBest && (t >> 3) & 1) Font.draw(g, 'УРА!', W / 2, y - 12, { scale: 1, align: 'center', color: '#ffd34d', ...OUTLINE_TEXT });
    if (overT > RESTART_AFTER && ((t >> 4) & 1 || overT < RESTART_AFTER + 30)) {
      Font.draw(g, 'ЕЩЁ РАЗ', W / 2, y + h + 14, { scale: 2, align: 'center', color: '#ffffff', ...OUTLINE_TEXT });
    }
  }

  // ── Кадр ────────────────────────────────────────────────────────────────────
  function render() {
    drawBackground();
    pipes.forEach(drawPipe);
    drawGround();
    drawTears();
    drawFace();
    if (state === 'menu') drawMenu();
    if (state === 'ready') drawReady();
    if (state === 'play') drawScore();
    drawBubble();
    if (state === 'over') drawOver();
    drawSpeaker();

    const k = scale;
    const sx = shake > 0 ? Math.round(rand(-1, 1) * Math.min(shake, 6) / 2) : 0;
    const sy = shake > 0 ? Math.round(rand(-1, 1) * Math.min(shake, 6) / 2) : 0;
    sg.imageSmoothingEnabled = false;
    sg.fillStyle = SKY[0];
    sg.fillRect(0, 0, screen.width, screen.height);
    sg.drawImage(lo, sx * k, sy * k, W * k, H * k);
    if (flash > 0) {
      sg.fillStyle = 'rgba(255, 255, 255, 0.45)';
      sg.fillRect(0, 0, screen.width, screen.height);
    }
  }

  // Целое число физических пикселей на пиксель игры: картинка чёткая, без «мыла».
  function fit() {
    const dpr = window.devicePixelRatio || 1;
    scale = Math.max(1, Math.floor(Math.min(innerWidth * dpr / W, innerHeight * dpr / H)));
    screen.width = W * scale;
    screen.height = H * scale;
    screen.style.width = W * scale / dpr + 'px';
    screen.style.height = H * scale / dpr + 'px';
    if (lo) render();
  }

  let last = 0, acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    acc += Math.min(now - last, 100) / 1000;
    last = now;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
  }

  // ── Ввод ────────────────────────────────────────────────────────────────────
  function onPointer(e) {
    e.preventDefault();
    const r = screen.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
    if (x > W - 22 && y < 20) { Sound.unlock(); Sound.toggleMute(); return; }   // значок звука
    if (state === 'menu') {                         // в меню играет только кнопка «ДА»
      const pad = 8;                                // с запасом под палец
      if (x >= YES.x - pad && x <= YES.x + YES.w + pad && y >= YES.y - pad && y <= YES.y + YES.h + pad) press();
      return;
    }
    press();
  }

  function onKey(e) {
    if (e.code === 'KeyM') { Sound.toggleMute(); return; }
    if (e.repeat || !['Space', 'ArrowUp', 'Enter', 'KeyW'].includes(e.code)) return;
    e.preventDefault();
    press();
  }

  // ── Запуск ──────────────────────────────────────────────────────────────────
  async function start() {
    const S = window.SPRITES || { face: null, pipes: [] };
    const [faceImg, cryImg, ...pipeImgs] = await Promise.all([
      S.face ? loadImage(S.face.src) : null,
      S.face && S.face.cry ? loadImage(S.face.cry) : null,
      ...(S.pipes || []).map(loadImage),
    ]);

    faceSprite = faceImg || smiley();
    crySprite = faceImg ? cryImg : null;
    faceDef = faceImg ? S.face : { eyes: DEFAULT_EYES, mouth: DEFAULT_MOUTH };
    FW = faceSprite.width; FH = faceSprite.height;
    hit = HIT.map((c) => ({ y: c.y * FH, r: c.r * FH }));
    faceWhite = canvas(FW, FH);
    const wx = faceWhite.getContext('2d');
    wx.drawImage(faceSprite, 0, 0, FW, FH);
    wx.globalCompositeOperation = 'source-in';
    wx.fillStyle = '#ffffff';
    wx.fillRect(0, 0, FW, FH);

    pipeSprites = pipeImgs.filter(Boolean);
    if (!pipeSprites.length) pipeSprites = [pipeAtlas()];

    best = readBest();
    groundX = cloudX = cityX = 0;
    reset();
    state = 'menu';                                 // игра открывается с вопроса, а не сразу со старта
    face.base = face.y = MENU_FACE_Y;
    Sound.music(true);                              // музыка играет всю игру, в полёте тише
    fit();
    addEventListener('resize', fit);
    screen.addEventListener('pointerdown', onPointer);
    addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => { last = 0; acc = 0; });
    requestAnimationFrame(frame);

    // Отладочный хук для проверки из консоли: __game.step(n), __bot = true.
    window.__game = {
      step(n = 1) { for (let i = 0; i < n; i++) update(); render(); },
      press, die,
      get state() { return state; },
      get score() { return score; },
      get best() { return best; },
      get face() { return face; },
      get pipes() { return pipes; },
      get tears() { return tears.length; },
      get scale() { return scale; },
      reset,
    };
  }

  start();
})();
