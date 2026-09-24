"""Make a labelled contact sheet from untouched behavioral probe page screenshots."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(font_path, 23)
small = ImageFont.truetype(font_path, 18)
cases = [
    ('navigation-return-middle.png', 'Back from navigation — 50%', 'Same raw canvases as the continuously visible control'),
    ('occlusion-return-settled.png', 'Back after hidden completion — 100%', 'Same raw canvases as the continuously visible control'),
    ('reduced-at-entry.png', 'Reduced motion on entry — 100%', 'Same raw canvases as the settled control'),
]
width, frame_height, top, bottom = 900, 550, 94, 40
sheet = Image.new('RGB', (width * len(cases), top + frame_height + bottom), '#f9f4ee')
draw = ImageDraw.Draw(sheet)
for index, (name, title, note) in enumerate(cases):
    x = index * width
    draw.text((x + 16, 12), title, font=font, fill='#24302d')
    draw.text((x + 16, 46), note, font=small, fill='#55625d')
    with Image.open(root / name) as source:
        assert source.size == (1800, 1100), (name, source.size)
        sheet.paste(source.convert('RGB').resize((width, frame_height), Image.Resampling.LANCZOS), (x, top))
    draw.text((x + 16, top + frame_height + 10), 'Both real consumers · controlled app clock · behavior evidence', font=small, fill='#55625d')
sheet.save(root / 'behavior-contact-sheet.png')

# Decode representative untouched frames from the native WebM. The original film is
# unchanged; this sheet is only an index to its actual timepoints, never another movie.
import subprocess
scratch = Path('/tmp/laneK-native-stills')
scratch.mkdir(parents=True, exist_ok=True)
ffmpeg = next((Path.home() / '.cache/ms-playwright').glob('ffmpeg-*/ffmpeg-linux'))
times = [3, 8, 12, 16, 20, 23]
film = Image.new('RGB', (width * 3, (frame_height + 56) * 2 + 70), '#f9f4ee')
fd = ImageDraw.Draw(film)
fd.text((16, 10), 'Native 23.92-second recording — real startup and app time, ordinary opening camera', font=font, fill='#24302d')
fd.text((16, 42), 'Decoded frames from the unedited video. Recording overhead applies; this sheet makes no smoothness claim.', font=small, fill='#55625d')
for index, seconds in enumerate(times):
    target = scratch / f'native-{seconds:02}.png'
    subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-ss', str(seconds), '-i', str(root / 'mounted-native-intro.webm'), '-frames:v', '1', '-y', str(target)], check=True)
    x = (index % 3) * width
    y = 70 + (index // 3) * (frame_height + 56)
    fd.text((x + 16, y + 12), f'{seconds} seconds into the native clip', font=font, fill='#24302d')
    with Image.open(target) as frame:
        film.paste(frame.convert('RGB').resize((width, frame_height), Image.Resampling.LANCZOS), (x, y + 56))
film.save(root / 'native-video-frame-sheet.png')
