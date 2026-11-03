#!/usr/bin/env bash
# Собирает архив для загрузки в консоль Яндекс Игр (index.html в корне архива).
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
if command -v zip >/dev/null; then
  zip -r -9 dist/snowball-yandex.zip index.html js >/dev/null
else
  python3 -c "import zipfile,os;z=zipfile.ZipFile('dist/snowball-yandex.zip','w',zipfile.ZIP_DEFLATED);z.write('index.html');[z.write(os.path.join('js',f)) for f in sorted(os.listdir('js'))];z.close()"
fi
echo "Готово: dist/snowball-yandex.zip ($(du -h dist/snowball-yandex.zip | cut -f1))"
