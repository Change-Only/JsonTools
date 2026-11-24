from PyInstaller.archive.readers import CArchiveReader
import os

r = CArchiveReader('dist/JSON工具箱.exe')
keys = set(r.toc)
files = []
for root, dirs, fs in os.walk('web'):
    for f in fs:
        files.append(os.path.join(root, f))
bad = []
for f in files:
    k = f.replace('/', '\\')
    if k not in keys:
        bad.append(('MISSING', f))
        continue
    embedded = r.extract(k)
    if isinstance(embedded, str):
        embedded = embedded.encode('utf-8')
    src = open(f, 'rb').read()
    if embedded != src:
        bad.append(('DIFF', f, len(embedded), len(src)))
print('source files:', len(files))
print('embedded web entries:', len([k for k in keys if k.startswith('web\\')]))
print('mismatches:', bad[:10], 'count:', len(bad))
