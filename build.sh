#!/usr/bin/env bash
# Собирает архивы для загрузки (index.html в корне архива):
#   dist/snowball-yandex.zip   — Яндекс Игры (SDK Яндекса)
#   dist/snowball-vk.zip       — VK Игры и Одноклассники (VK Bridge)
#   dist/snowball-playgama.zip — Playgama (Playgama Bridge SDK + playgama-bridge-config.json)
# В index.html блоки платформ помечены <!-- имя:start --> … <!-- имя:end -->;
# каждая сборка оставляет только свой блок.
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
PLATFORMS="yandex vk playgama"

build() {
  local name="$1"
  local dir="dist/$name"
  mkdir -p "$dir/js"

  local sed_args=()
  for other in $PLATFORMS; do
    [ "$other" = "$name" ] && continue
    sed_args+=(-e "/<!-- $other:start -->/,/<!-- $other:end -->/d")
  done
  sed "${sed_args[@]}" -e '/<!-- [a-z]*:\(start\|end\) -->/d' index.html > "$dir/index.html"

  # Общий код + код только своей платформы
  cp js/i18n.js js/audio.js js/sdk.js js/game.js "$dir/js/"
  # Звуковые эффекты (Kenney, CC0) и фоновая музыка (3xBlast, CC0) — во всех сборках
  mkdir -p "$dir/assets/sfx" "$dir/assets/music"
  cp assets/sfx/*.ogg assets/sfx/*.mp3 "$dir/assets/sfx/"
  cp assets/music/*.ogg assets/music/*.mp3 "$dir/assets/music/"
  cp assets/CREDITS.txt "$dir/assets/"
  case "$name" in
    vk)
      cp js/platform-vk.js js/vk-bridge.min.js js/vk-bridge.LICENSE "$dir/js/"
      mkdir -p "$dir/img" && cp img/* "$dir/img/"      # картинка для историй
      ;;
    playgama)
      cp js/platform-playgama.js "$dir/js/"
      cp playgama/playgama-bridge.js playgama/playgama-bridge-config.json playgama/LICENSE-playgama-bridge.txt "$dir/"
      ;;
  esac

  (
    cd "$dir"
    if command -v zip >/dev/null; then
      zip -r -9 "../snowball-$name.zip" . >/dev/null
    else
      python3 -c "import zipfile,os
z=zipfile.ZipFile('../snowball-$name.zip','w',zipfile.ZIP_DEFLATED)
for root,_,files in os.walk('.'):
    for f in sorted(files): z.write(os.path.join(root,f), os.path.relpath(os.path.join(root,f),'.'))
z.close()"
    fi
  )
  rm -rf "$dir"
  echo "Готово: dist/snowball-$name.zip ($(du -h "dist/snowball-$name.zip" | cut -f1))"
}

for p in $PLATFORMS; do build "$p"; done
