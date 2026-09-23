"""Compare frozen-data road captures and crop their original pixels, without changing art."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

p = Path.cwd() / 'docs/research/mounted-land-design-review-2026-09-23'
before = json.loads((p / 'roads-before.json').read_text())
after = json.loads((p / 'roads-after.json').read_text())
report = {'viewsCompared': 0, 'unchangedFlatImages': 0, 'errors': before['errors'] + after['errors'], 'flatImageDifferences': {}}
assert not report['errors']
assert before['snapshotSha256'] == after['snapshotSha256']
report['snapshotSha256'] = before['snapshotSha256']
assert set(before['views']) == set(after['views'])
for name, old in before['views'].items():
    new = after['views'][name]
    for field in ['camera', 'world', 'statuses', 'counts', 'paint']:
        assert old[field] == new[field], (name, field)
    assert old['labels'] == new['labels'], (name, 'labels')
    report['viewsCompared'] += 1
    if name.startswith('flat-'):
        a = Image.open(p / 'roads-before' / f'{name}.png').convert('RGB')
        b = Image.open(p / 'roads-after' / f'{name}.png').convert('RGB')
        difference = ImageChops.difference(a, b)
        if difference.getbbox() is None:
            report['unchangedFlatImages'] += 1
        else:
            # Preserve and report full-image differences; do not call these pixel-identical.
            report['flatImageDifferences'][name] = {
                'bounds': difference.getbbox(),
                'channelMaxima': [extent[1] for extent in difference.getextrema()],
                'changedPixels': sum(pixel != (0, 0, 0) for pixel in difference.getdata()),
            }
            # The observed fit-only differences are UI blur edges. Its entire forest is exact.
            assert name == 'flat-fit', name
            assert difference.crop((300, 40, 1300, 1030)).getbbox() is None
            report['flatImageDifferences'][name]['forestPixelsIdentical'] = True

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
for view, bounds, output in [
    ('props-library', (660, 375, 1120, 675), 'roads-library'),
    ('props-drive-machinery', (650, 290, 1150, 670), 'roads-drive-machinery'),
]:
    width, height = bounds[2]-bounds[0], bounds[3]-bounds[1]
    sheet = Image.new('RGB', (2*width+30, height+50), '#faf7f0')
    draw = ImageDraw.Draw(sheet)
    for i, (phase, title) in enumerate([
        ('roads-before', 'Before: ribbons stop offshore'),
        ('roads-after', 'After: ribbons meet their shore paths'),
    ]):
        crop = Image.open(p / phase / f'{view}.png').crop(bounds)
        crop.save(p / f'{output}-{i}.png')
        sheet.paste(crop, (10+i*(width+10), 40))
        draw.text((10+i*(width+10), 10), title, font=font, fill='#26332b')
    sheet.save(p / f'{output}-comparison.png')

(p / 'roads-verification.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
