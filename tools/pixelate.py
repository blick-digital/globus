#!/usr/bin/env python3
"""Фото → пиксель-спрайты для игры.

Читает source/:
  face.jpg       лицо анфас, крупно            → assets/face.png
  face.json      контур головы и точки лица    (см. ниже)
  face-cry.jpg   (необязательно) плачущее лицо → assets/face-cry.png
  pipe*.jpg      фото труб (можно несколько)    → assets/pipe-0.png, pipe-1.png…

и пишет манифест assets/js/sprites.js, который читает игра. Расширения —
jpg, jpeg, png, webp, bmp, tif. Нужен Pillow.

Голова вырезается по контуру из source/face.json, а не по кругу: видны скулы,
челюсть и уши. Все координаты в нём — в пикселях исходного фото:

  {
    "outline": [[x, y], ...],        контур головы по часовой стрелке
    "eyes":    [[x, y], [x, y]],     центры левого и правого глаза
    "mouth":   [x, y]                линия губ: по ней у спрайта отвисает челюсть
  }

Если face.json нет, берётся овал по центру кадра (или по --face-box), а глаза и
рот ставятся по типичным пропорциям.

  python3 tools/pixelate.py
  python3 tools/pixelate.py --height 40            # крупнее спрайт (по умолчанию 34)
  python3 tools/pixelate.py --face-box 300,120,600,800   # овал вместо контура
  python3 tools/pixelate.py --rotate                      # труба лежит на боку

Размеры спрайтов труб (PIPE_W, CAP_W, CAP_H, TILE_H) должны совпадать с
константами в начале assets/js/game.js.
"""
import argparse
import json
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'source')
OUT = os.path.join(ROOT, 'assets')
MANIFEST = os.path.join(OUT, 'js', 'sprites.js')

EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff')
OUTLINE = (24, 22, 38)

FACE_H = 34                                 # высота головы без обводки, px
SUPER = 4                                   # во сколько раз уменьшаем: сглаживает шум
PIPE_W, CAP_W, CAP_H, TILE_H = 26, 30, 12, 16
PIPE_COLORS = 7                             # цветов в палитре трубы


def find(stem=None, prefix=None):
    """Файлы из source/ с точным именем stem или с началом имени prefix."""
    if not os.path.isdir(SRC):
        return []
    found = []
    for name in sorted(os.listdir(SRC)):
        base, ext = os.path.splitext(name)
        if ext.lower() not in EXTS:
            continue
        if (stem and base.lower() == stem) or (prefix and base.lower().startswith(prefix)):
            found.append(os.path.join(SRC, name))
    return found


def load(path, rotate=False):
    img = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    return img.rotate(90, expand=True) if rotate else img


def downscale(img, w, h):
    """Сначала LANCZOS в 4× (сглаживает шум), затем BOX: даёт чистые «пиксели»."""
    return img.resize((w * 4, h * 4), Image.LANCZOS).resize((w, h), Image.BOX)


def crop_center(img, aspect):
    W, H = img.size
    if W / H > aspect:
        w, h = round(H * aspect), H
    else:
        w, h = W, round(W / aspect)
    x, y = (W - w) // 2, (H - h) // 2
    return img.crop((x, y, x + w, y + h))


def quantize(img, colors):
    q = img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT,
                     dither=Image.Dither.NONE)
    return q.convert('RGB')


def clamp(v):
    return 0 if v < 0 else 255 if v > 255 else int(v)


# ── лицо ────────────────────────────────────────────────────────────────────

def ellipse_outline(img, box):
    """Запасной контур: овал по центру кадра, если нет face.json."""
    W, H = img.size
    if box:
        x, y, w, h = box
    else:
        w, h = W * 0.8, H * 0.8
        x, y = (W - w) / 2, (H - h) / 2
    cx, cy = x + w / 2, y + h / 2
    return [[cx + w / 2 * math.cos(a * math.pi / 32), cy + h / 2 * math.sin(a * math.pi / 32)]
            for a in range(64)]


def head_sprite(path, outline, height):
    """Голова по контуру → спрайт RGBA с обводкой в 1 px и размерами головы.

    Возвращает (спрайт, f), где f(x, y) переводит точку исходного фото в долю
    ширины и высоты спрайта."""
    img = load(path)
    xs, ys = zip(*outline)
    bx0, by0, bx1, by1 = int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1
    bw, bh = bx1 - bx0, by1 - by0
    th = height
    tw = max(8, round(th * bw / bh))

    big = (tw * SUPER, th * SUPER)
    crop = img.crop((bx0, by0, bx1, by1)).resize(big, Image.LANCZOS)
    mask = Image.new('L', big, 0)
    kx, ky = big[0] / bw, big[1] / bh
    ImageDraw.Draw(mask).polygon([((x - bx0) * kx, (y - by0) * ky) for x, y in outline], fill=255)

    # Цвет усредняем только по голове (с весом маски), чтобы фон не просачивался
    # на краях силуэта.
    pm = ImageChops.multiply(crop, Image.merge('RGB', (mask, mask, mask)))
    pm_s = pm.resize((tw, th), Image.BOX)
    m_s = mask.resize((tw, th), Image.BOX)

    solid = [[m_s.getpixel((x, y)) >= 128 for x in range(tw)] for y in range(th)]
    rgb = Image.new('RGB', (tw, th))
    px = rgb.load()
    for y in range(th):
        for x in range(tw):
            m = m_s.getpixel((x, y))
            if solid[y][x]:
                px[x, y] = tuple(min(255, c * 255 // m) for c in pm_s.getpixel((x, y)))
    mean = tuple(int(sum(c) / len(c)) for c in zip(*[px[x, y] for y in range(th)
                 for x in range(tw) if solid[y][x]]))
    for y in range(th):
        for x in range(tw):
            if not solid[y][x]:
                px[x, y] = mean

    rgb = ImageEnhance.Color(ImageEnhance.Contrast(rgb).enhance(1.12)).enhance(1.0)
    rgb = quantize(rgb, 16)

    pad = 1                                    # место под обводку со всех сторон
    out = Image.new('RGBA', (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0))
    op, src = out.load(), rgb.load()

    def is_solid(x, y):
        return 0 <= x < tw and 0 <= y < th and solid[y][x]

    for y in range(-pad, th + pad):
        for x in range(-pad, tw + pad):
            if is_solid(x, y):
                op[x + pad, y + pad] = src[x, y] + (255,)
            elif any(is_solid(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                op[x + pad, y + pad] = OUTLINE + (255,)

    def frac(x, y):
        return ((x - bx0) / bw * tw + pad) / (tw + 2 * pad), ((y - by0) / bh * th + pad) / (th + 2 * pad)

    return out, frac


def read_face_meta():
    try:
        with open(os.path.join(SRC, 'face.json'), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


# ── трубы ───────────────────────────────────────────────────────────────────

def column_factor(x, w):
    """Ступенчатая «цилиндрическая» подсветка: блик слева, тень справа."""
    t = x / (w - 1)
    if t < .10:
        return 1.10
    if t < .28:
        return 1.32
    if t < .55:
        return 1.05
    if t < .80:
        return .85
    return .62


def shade(img, rows=None):
    px = img.load()
    w, h = img.size
    for x in range(w):
        f = column_factor(x, w)
        for y in range(h):
            k = f * (rows.get(y, 1) if rows else 1)
            r, g, b = px[x, y]
            px[x, y] = (clamp(r * k), clamp(g * k), clamp(b * k))
    return img


def pipe_sprite(path, rotate):
    """Атлас 30×28: шапка 30×12 сверху, под ней бесшовное тело 26×16 по центру."""
    img = load(path, rotate)

    # Тело: верхнюю половину тайла отражаем вниз, чтобы стык был бесшовным.
    top = downscale(crop_center(img, PIPE_W / (TILE_H // 2)), PIPE_W, TILE_H // 2)
    body = Image.new('RGB', (PIPE_W, TILE_H))
    body.paste(top, (0, 0))
    body.paste(ImageOps.flip(top), (0, TILE_H // 2))
    body = shade(body)

    cap = downscale(crop_center(img, CAP_W / CAP_H), CAP_W, CAP_H)
    cap = shade(cap, {1: 1.18, CAP_H - 2: .72})

    mean = tuple(int(sum(c) / len(c)) for c in zip(*[body.getpixel((x, y))
                 for x in range(PIPE_W) for y in range(TILE_H)]))
    h = CAP_H + TILE_H
    atlas = Image.new('RGB', (CAP_W, h), mean)
    atlas.paste(cap, (0, 0))
    atlas.paste(body, ((CAP_W - PIPE_W) // 2, CAP_H))
    atlas = quantize(atlas, PIPE_COLORS)

    out = Image.new('RGBA', (CAP_W, h), (0, 0, 0, 0))
    px, src = out.load(), atlas.load()
    x0 = (CAP_W - PIPE_W) // 2
    for y in range(h):
        for x in range(CAP_W):
            if y < CAP_H:
                edge = x in (0, CAP_W - 1) or y in (0, CAP_H - 1)
                px[x, y] = OUTLINE + (255,) if edge else src[x, y] + (255,)
            elif x0 <= x < x0 + PIPE_W:
                edge = x in (x0, x0 + PIPE_W - 1)
                px[x, y] = OUTLINE + (255,) if edge else src[x, y] + (255,)
    return out


# ── манифест ────────────────────────────────────────────────────────────────

def write_manifest(data):
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        f.write('/* Создаётся tools/pixelate.py — руками не править. */\n'
                'window.SPRITES = ' + json.dumps(data, ensure_ascii=False) + ';\n')


def floats(text, n, name):
    try:
        v = [float(s) for s in text.split(',')]
    except ValueError:
        v = []
    if len(v) != n:
        sys.exit('%s: нужно %d числа через запятую' % (name, n))
    return v


def round3(v):
    return round(v, 3)


def main():
    ap = argparse.ArgumentParser(description='Фото → пиксель-спрайты')
    ap.add_argument('--height', type=int, default=FACE_H, help='высота головы в пикселях игры')
    ap.add_argument('--face-box', help='x,y,w,h — овал вместо контура из face.json')
    ap.add_argument('--rotate', action='store_true', help='повернуть фото труб на 90°')
    args = ap.parse_args()

    manifest = {'face': None, 'pipes': []}

    faces = find(stem='face')
    if faces:
        meta = read_face_meta()
        photo = load(faces[0])
        if args.face_box:
            outline = ellipse_outline(photo, [int(v) for v in floats(args.face_box, 4, '--face-box')])
        else:
            outline = meta.get('outline') or ellipse_outline(photo, None)
        xs, ys = zip(*outline)
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        w, h = x1 - x0, y1 - y0
        # Без точек в face.json — типичные пропорции головы.
        eyes = meta.get('eyes') or [[x0 + w * .30, y0 + h * .46], [x0 + w * .70, y0 + h * .46]]
        mouth = meta.get('mouth') or [x0 + w * .50, y0 + h * .78]

        sprite, frac = head_sprite(faces[0], outline, args.height)
        sprite.save(os.path.join(OUT, 'face.png'))
        manifest['face'] = {
            'src': 'assets/face.png', 'cry': None,
            'eyes': [dict(zip('xy', map(round3, frac(*e)))) for e in eyes],
            'mouth': dict(zip('xy', map(round3, frac(*mouth)))),
        }
        print('лицо:  %s → assets/face.png (%dx%d)' % (os.path.basename(faces[0]), *sprite.size))

        cries = find(stem='face-cry')
        if cries:
            head_sprite(cries[0], outline, args.height)[0].save(os.path.join(OUT, 'face-cry.png'))
            manifest['face']['cry'] = 'assets/face-cry.png'
            print('плач:  %s → assets/face-cry.png' % os.path.basename(cries[0]))
    else:
        print('лицо:  source/face.jpg не найден — в игре останется смайлик-заглушка')

    for name in os.listdir(OUT):
        if name.startswith('pipe-') and name.endswith('.png'):
            os.remove(os.path.join(OUT, name))
    for i, path in enumerate(find(prefix='pipe')):
        dst = 'assets/pipe-%d.png' % i
        pipe_sprite(path, args.rotate).save(os.path.join(ROOT, dst))
        manifest['pipes'].append(dst)
        print('труба: %s → %s' % (os.path.basename(path), dst))
    if not manifest['pipes']:
        print('трубы: source/pipe*.jpg не найдены — в игре останутся трубы-амулеты')

    write_manifest(manifest)
    print('манифест: assets/js/sprites.js')


if __name__ == '__main__':
    main()
