"""Собрать ZIP только с файлами, необходимыми для установки расширения."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
files = ['manifest.json', 'background.js', 'client.js', 'engine.js', 'panel.js',
         'popup.html', 'popup.css', 'popup.js', 'README.md', 'NOTICE.md', 'CHANGELOG.md',
         'fonts/Montserrat-Variable.woff2', 'fonts/OFL.txt']
files += [f'icons/icon-{size}.png' for size in (16, 32, 48, 96, 128)]
output = root / 'dist' / f'syncshare-assistant-v{manifest["version"]}.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        source = root / name
        if not source.is_file():
            raise FileNotFoundError(name)
        archive.write(source, name)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
print(f'ZIP: {output.name} ({output.stat().st_size} bytes)')
