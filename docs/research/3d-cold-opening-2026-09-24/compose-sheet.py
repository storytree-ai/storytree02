"""Before/after frame sheet from the two unedited native recordings (same snapshot, same viewport,
production build). Frames are decoded at identical clip times; nothing is edited or re-timed."""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
big = ImageFont.truetype(font_path, 26)
font = ImageFont.truetype(font_path, 21)
small = ImageFont.truetype(font_path, 17)
ffmpeg = next((Path.home() / '.cache/ms-playwright').glob('ffmpeg-*/ffmpeg-linux'))
scratch = Path('/tmp/laneS-stills')
scratch.mkdir(parents=True, exist_ok=True)
times = [2, 4, 5, 6, 8, 13, 20, 27]
rows = [('before', 'BEFORE — growth clock starts when the flat map is ready (~1.4 s)'),
        ('after', 'AFTER — growth clock starts when the 3D land has drawn its first frame')]
w, h, label_h, row_title = 450, 275, 34, 44
sheet = Image.new('RGB', (w * len(times), 90 + len(rows) * (row_title + label_h + h) + 10), '#f9f4ee')
d = ImageDraw.Draw(sheet)
d.text((16, 12), 'The studio\'s 3D map opening, production build — same live snapshot, same 1800×1100 viewport', font=big, fill='#24302d')
d.text((16, 52), 'Decoded frames of the two unedited native recordings, at the same seconds into each clip. Page load begins a fraction of a second into each clip.', font=small, fill='#55625d')
y = 90
for name, title in rows:
    d.text((16, y + 8), title, font=font, fill='#24302d')
    y += row_title
    for i, t in enumerate(times):
        target = scratch / f'{name}-{t:02}.png'
        subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-ss', str(t), '-i', str(root / f'opening-{name}.webm'), '-frames:v', '1', '-y', str(target)], check=True)
        d.text((i * w + 12, y + 6), f'{t} s', font=font, fill='#24302d')
        with Image.open(target) as frame:
            assert frame.size == (1800, 1100), frame.size
            sheet.paste(frame.convert('RGB').resize((w - 6, h), Image.Resampling.LANCZOS), (i * w + 3, y + label_h))
    y += label_h + h
sheet.save(root / 'opening-before-after-frame-sheet.png')

# Close-ups of the first seconds, where the change is: half-scale frames, before above after.
close_times = [3, 5, 6.5, 8]
cw, ch = 900, 550
close = Image.new('RGB', (cw * len(close_times), 70 + 2 * (40 + 34 + ch)), '#f9f4ee')
c = ImageDraw.Draw(close)
c.text((16, 12), 'The first seconds, close up — before (top) and after (bottom), same clip times', font=big, fill='#24302d')
y = 70
for name, title in rows:
    c.text((16, y + 6), title, font=font, fill='#24302d')
    y += 40
    for i, t in enumerate(close_times):
        target = scratch / f'close-{name}-{t}.png'
        subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-ss', str(t), '-i', str(root / f'opening-{name}.webm'), '-frames:v', '1', '-y', str(target)], check=True)
        c.text((i * cw + 12, y + 6), f'{t} s', font=font, fill='#24302d')
        with Image.open(target) as frame:
            close.paste(frame.convert('RGB').resize((cw - 6, ch), Image.Resampling.LANCZOS), (i * cw + 3, y + 34))
    y += 34 + ch
close.save(root / 'opening-first-seconds-closeup.png')
