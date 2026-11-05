#!/usr/bin/env bash
# Собирает архивы для загрузки (index.html в корне архива):
#   dist/snowball-yandex.zip — Яндекс Игры (без VK Bridge)
#   dist/snowball-vk.zip     — VK Игры (без SDK Яндекса)
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist

build() {
  local name="$1" drop="$2"
  local dir="dist/$name"
  mkdir -p "$dir/js"
  # Убираем блок другой платформы, помеченный <!-- drop:start --> … <!-- drop:end -->
  sed -e "/<!-- $drop:start -->/,/<!-- $drop:end -->/d" -e '/<!-- [a-z]*:\(start\|end\) -->/d' index.html > "$dir/index.html"
  cp js/*.js "$dir/js/"
  # Картинка для историй нужна только в VK/OK
  if [ -d img ] && [ "$name" != yandex ]; then mkdir -p "$dir/img" && cp img/* "$dir/img/"; fi
  if [ "$name" = yandex ]; then rm "$dir/js/vk-bridge.min.js"; else cp js/vk-bridge.LICENSE "$dir/js/"; fi
  (
    cd "$dir"
    if command -v zip >/dev/null; then
      zip -r -9 "../snowball-$name.zip" index.html js $( [ -d img ] && echo img ) >/dev/null
    else
      python3 -c "import zipfile,os;z=zipfile.ZipFile('../snowball-$name.zip','w',zipfile.ZIP_DEFLATED);z.write('index.html');[z.write(os.path.join(d,f)) for d in ('js','img') if os.path.isdir(d) for f in sorted(os.listdir(d))];z.close()"
    fi
  )
  rm -rf "$dir"
  echo "Готово: dist/snowball-$name.zip ($(du -h "dist/snowball-$name.zip" | cut -f1))"
}

build yandex vk
build vk yandex
