"""Compose literal product screenshots. No generated or retouched product pixels."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

here = Path(__file__).resolve().parent
data = json.loads((here / 'measurements.json').read_text())
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(font_path, 22)
small = ImageFont.truetype(font_path, 17)
tile_width = 900
tile_height = 550
heading = 78

def tile(arm, name, title):
    item = data['arms'][arm]['views'][name]
    image = Image.open(here / item['file']).convert('RGB')
    panel = Image.new('RGB', (tile_width, tile_height + heading), '#101719')
    panel.paste(image.resize((tile_width, tile_height), Image.Resampling.LANCZOS), (0, heading))
    draw = ImageDraw.Draw(panel)
    draw.text((18, 10), title, font=font, fill='#f4efdc')
    draw.text((18, 43), item['readout'], font=small, fill='#c6cbbd')
    return panel

sheet = Image.new('RGB', (tile_width * 3, tile_height + heading), '#101719')
for column, (name, title) in enumerate([('early', 'Early'), ('middle', 'Middle'), ('settled', 'Settled')]):
    sheet.paste(tile('active', name, title), (column * tile_width, 0))
sheet.save(here / 'regrow-frame-sheet.png')

comparison = Image.new('RGB', (tile_width * 2, (tile_height + heading) * 2), '#101719')
for row, name in enumerate(['early', 'middle']):
    comparison.paste(tile('control', name, 'Control: 3D land already grown'), (0, row * (tile_height + heading)))
    comparison.paste(tile('active', name, 'Now: 3D land follows the app cursor'), (tile_width, row * (tile_height + heading)))
comparison.save(here / 'regrow-control-comparison.png')

# A short stepped preview, explicitly not a real-time playback or performance measurement.
preview = [tile('active', name, f'Clock-sampled preview: {name}') for name in ['start', 'early', 'middle', 'late', 'settled']]
preview[0].save(here / 'regrow-sampled-preview.webp', save_all=True, append_images=preview[1:], duration=[700, 1100, 1100, 1100, 2000], loop=0, quality=90)

a = Image.open(here / 'active-settled.png').convert('RGB')
b = Image.open(here / 'control-settled.png').convert('RGB')
diff = ImageChops.difference(a, b)
changed_pixels = sum(pixel != (0, 0, 0) for pixel in diff.getdata())
verification = {'settledPixelIdentical': diff.getbbox() is None, 'settledDifferenceBoundingBox': diff.getbbox(), 'settledChangedPixels': changed_pixels, 'note': 'Full screenshot comparison includes live app chrome; the structured camera/data comparison is asserted separately.'}
canvas_a = Image.open(here / 'active-settled-canvas.png').convert('RGBA')
canvas_b = Image.open(here / 'control-settled-canvas.png').convert('RGBA')
canvas_diff = ImageChops.difference(canvas_a, canvas_b)
verification['settledCanvasPixelIdentical'] = canvas_a.tobytes() == canvas_b.tobytes()
verification['settledCanvasChangedPixels'] = sum(pixel != (0, 0, 0, 0) for pixel in canvas_diff.getdata())
verification['settledCanvasSize'] = list(canvas_a.size)
verification['coverageDiagnostics'] = {}
for name in ['early', 'middle']:
    original = Image.open(here / f'active-{name}.png').convert('RGB')
    hidden = Image.open(here / f'active-{name}-no-svg-coverage.png').convert('RGB')
    difference = ImageChops.difference(original, hidden)
    verification['coverageDiagnostics'][name] = {'changedPixels': sum(pixel != (0, 0, 0) for pixel in difference.getdata()), 'bounds': difference.getbbox()}
(here / 'image-verification.json').write_text(json.dumps(verification, indent=2) + '\n')
print(json.dumps(verification))
