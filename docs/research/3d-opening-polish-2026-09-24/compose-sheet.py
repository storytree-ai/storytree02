"""Before/after pictures of the studio's 3D map opening, from the two unedited native recordings and
the unrecorded timing runs (same frozen snapshot, same 1800x1100 viewport, production build, RTX 2060).
Frames are decoded at identical clip times; nothing is edited or re-timed."""
import json, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
big = ImageFont.truetype(font_path, 26)
font = ImageFont.truetype(font_path, 21)
small = ImageFont.truetype(font_path, 17)
ffmpeg = next((Path.home() / '.cache/ms-playwright').glob('ffmpeg-*/ffmpeg-linux'))
scratch = Path('/tmp/laneU-stills')
scratch.mkdir(parents=True, exist_ok=True)
rows = [('before', 'BEFORE (main) — notice over the growth control; plants load after the land appears'),
        ('after', 'AFTER — notice centred and held until land AND plants have drawn; plant targets unpainted')]

def still(name, t):
    target = scratch / f'{name}-{t}.png'
    subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-ss', str(t), '-i', str(root / f'opening-{name}.webm'), '-frames:v', '1', '-y', str(target)], check=True)
    img = Image.open(target).convert('RGB')
    assert img.size == (1800, 1100), img.size
    return img

# 1. The whole opening: start, the wait, first growth, mid, the last fifth, settled.
times = [3, 5, 6.5, 8, 14, 21, 25, 30]
w, h, label_h, row_title = 450, 275, 34, 44
sheet = Image.new('RGB', (w * len(times), 90 + len(rows) * (row_title + label_h + h) + 10), '#f9f4ee')
d = ImageDraw.Draw(sheet)
d.text((16, 12), "The studio's 3D map opening, production build — same live snapshot, same 1800×1100 viewport", font=big, fill='#24302d')
d.text((16, 52), 'Decoded frames of the two unedited native recordings at the same seconds into each clip. 21 s and 25 s fall in the last fifth of the growth.', font=small, fill='#55625d')
y = 90
for name, title in rows:
    d.text((16, y + 8), title, font=font, fill='#24302d')
    y += row_title
    for i, t in enumerate(times):
        d.text((i * w + 12, y + 6), f'{t} s', font=font, fill='#24302d')
        sheet.paste(still(name, t).resize((w - 6, h), Image.Resampling.LANCZOS), (i * w + 3, y + label_h))
    y += label_h + h
sheet.save(root / 'opening-before-after-frame-sheet.png')

# 2. The notice, full resolution: the top half of the map at 3 s (both still loading).
crop = (300, 0, 1500, 620)
cw, ch = crop[2] - crop[0], crop[3] - crop[1]
close = Image.new('RGB', (cw * 2 + 30, 70 + 40 + ch + 10), '#f9f4ee')
c = ImageDraw.Draw(close)
c.text((16, 12), 'The loading notice at 3 s, full resolution — before (left) and after (right)', font=big, fill='#24302d')
for i, (name, title) in enumerate(rows):
    c.text((i * (cw + 30) + 12, 74), 'BEFORE — drawn over the growth control' if name == 'before' else 'AFTER — in the middle of the empty map', font=font, fill='#24302d')
    close.paste(still(name, 3).crop(crop), (i * (cw + 30), 110))
close.save(root / 'loading-notice-closeup.png')

# 3. Slow frames through the whole opening: every frame over 150 ms after the land reported ready,
#    all three unrecorded timing runs per arm, plotted against time since navigation.
cw, ch, pad = 1800, 260, 70
chart = Image.new('RGB', (cw, 80 + 2 * (ch + 60)), '#f9f4ee')
g = ImageDraw.Draw(chart)
g.text((16, 12), 'Frames slower than 150 ms after the land appeared — 3 runs per arm, production build, RTX 2060', font=big, fill='#24302d')
g.text((16, 48), 'Each mark is one frame; its height is how long the screen stood still. A smooth opening has no marks.', font=small, fill='#55625d')
x_of = lambda ms: pad + (cw - 2 * pad) * ms / 30000
y0 = 80
for name, title in rows:
    runs = json.loads((root / f'timing-{name}.json').read_text())['runs']
    base = y0 + 40 + ch
    g.text((16, y0 + 8), ('BEFORE' if name == 'before' else 'AFTER') + f" — {sum(len(r['summary']['freezesOver150msAfterLandReady']) for r in runs)} slow frames across 3 runs", font=font, fill='#24302d')
    g.line((pad, base, cw - pad, base), fill='#8a948f')
    for ms in (0, 700):
        yy = base - ch * ms / 700
        g.text((8, yy - 9), f'{ms}', font=small, fill='#55625d')
    for s in range(0, 31, 5):
        g.text((x_of(s * 1000) - 8, base + 4), f'{s}s', font=small, fill='#55625d')
    for run in runs:
        ready = run['summary']['landReadyMs']
        g.line((x_of(ready), base - ch, x_of(ready), base), fill='#6b9bd1')
        for f in run['summary']['freezesOver150msAfterLandReady']:
            x = x_of(f['fromMs'])
            g.rectangle((x - 3, base - ch * min(f['ms'], 700) / 700, x + 3, base), fill='#b3452f')
    g.text((cw - 420, y0 + 12), 'blue line: land ready (growth starts)', font=small, fill='#6b9bd1')
    y0 += ch + 60
chart.save(root / 'slow-frames-before-after.png')
