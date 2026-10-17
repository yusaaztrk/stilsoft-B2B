#!/bin/sh
# Vitrin ekran görüntüsü alma yardımcısı.
#
# NEDEN VAR: bu ortamda tarayıcı paneli gizli olduğu için sayfa kare üretmiyor ve normal
# ekran görüntüsü alınamıyor. Tasarım işini görmeden yapmak üç tur boşa gitti; başsız Chrome
# ile gerçek piksel almak tek yol.
#
# Kullanım:  sh sshot.sh <ad> <yol> [genislik] [yukseklik]
#   sh sshot.sh home / 1440 1500
#   sh sshot.sh mobil /urunler 390 1400

AD="${1:-shot}"
YOL="${2:-/}"
GEN="${3:-1440}"
YUK="${4:-1500}"
CIKTI="C:\\Users\\Admin\\AppData\\Local\\Temp\\ss_${AD}.png"

"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size="${GEN},${YUK}" \
  --virtual-time-budget=9000 \
  --screenshot="${CIKTI}" \
  "http://localhost:3000${YOL}" 2>&1 | grep -i "written\|error"
