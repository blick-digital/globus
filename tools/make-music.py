#!/usr/bin/env python3
"""Вырезает кусок песни для стартовой заставки → assets/audio/music.m4a.

  python3 tools/make-music.py "/путь/к/песне.mp3"
  python3 tools/make-music.py "/путь/к/песне.mp3" --start 103 --length 20

Нужны macOS (afconvert) и Python 3 с audioop. Кусок получает плавный вход и
затухание в конце, чтобы при зацикливании не было щелчка.
"""
import argparse
import audioop
import os
import subprocess
import sys
import tempfile
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'audio', 'music.m4a')


def fade(frames, width, sr, fade_in, fade_out):
    """Линейные вход и выход громкости по 16-битным кадрам с шириной width (байт на кадр)."""
    n = len(frames) // width
    chunk = sr // 50                              # шаг 20 мс
    out = bytearray()
    for i in range(0, n, chunk):
        t = i / sr
        total = n / sr
        k = 1.0
        if t < fade_in:
            k = t / fade_in
        if total - t < fade_out:
            k = min(k, max(0.0, (total - t) / fade_out))
        out += audioop.mul(frames[i * width:(i + chunk) * width], 2, k)
    return bytes(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--start', type=float, default=22.1, help='с какой секунды (по умолчанию — бит «падает»)')
    ap.add_argument('--length', type=float, default=20.0, help='сколько секунд')
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        wav, cut = os.path.join(tmp, 'a.wav'), os.path.join(tmp, 'b.wav')
        subprocess.check_call(['afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', args.src, wav])
        w = wave.open(wav)
        sr, ch = w.getframerate(), w.getnchannels()
        width = 2 * ch
        w.setpos(min(int(args.start * sr), w.getnframes()))
        frames = w.readframes(int(args.length * sr))
        if not frames:
            sys.exit('--start за концом песни')
        frames = fade(frames, width, sr, 0.15, 1.5)
        o = wave.open(cut, 'wb')
        o.setnchannels(ch); o.setsampwidth(2); o.setframerate(sr)
        o.writeframes(frames)
        o.close()
        subprocess.check_call(['afconvert', '-f', 'mp4f', '-d', 'aac', '-b', '128000', cut, OUT])
    print('готово:', OUT)


if __name__ == '__main__':
    main()
