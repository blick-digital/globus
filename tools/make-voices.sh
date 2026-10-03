#!/bin/zsh
# Синтезирует голоса героя голосом Milena (macOS) и кладёт их в assets/audio:
#   cry.m4a  — «Ебаный в рот!» при ударе;
#   am.m4a   — короткое «Ам!» на каждый взмах.
# AAC читают все браузеры; mp3-энкодера в системе нет.
#
# Свои записи: положите assets/audio/cry.mp3 и/или assets/audio/am.mp3 —
# игра берёт mp3 первым, а сгенерированные m4a остаются запасными.
#
#   zsh tools/make-voices.sh

set -eu
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# [[pbas]] — базовая высота, [[pmod]] — размах интонации, [[rate]] — темп.
# Протяжные гласные и дефисы заставляют голос тянуть и «всхлипывать».
render() {  # имя  текст
  say -v Milena -o "$TMP/$1.aiff" "$2"
  afconvert -f mp4f -d aac -b 64000 "$TMP/$1.aiff" "assets/audio/$1.m4a"
  echo "assets/audio/$1.m4a:"
  afinfo "assets/audio/$1.m4a" | grep -E 'estimated duration'
}

render cry  "[[rate 110]] [[pbas 56]] [[pmod 55]] Ебаа-аный в рот!"
render am   "[[rate 200]] [[pbas 55]] [[pmod 30]] Ам!"
