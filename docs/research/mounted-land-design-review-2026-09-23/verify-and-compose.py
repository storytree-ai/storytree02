"""Validate captured controls and crop their original pixels; run after capture.mjs finishing."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont
p = Path(__file__).parent
before = json.loads((p / 'before.json').read_text())
after = json.loads((p / 'after.json').read_text())
finish = json.loads((p / 'finishing.json').read_text())
report = {'viewsCompared': 0, 'unchangedFlatImages': 0, 'errors': after['errors'] + finish['errors']}
assert not report['errors']
for name, old in before['views'].items():
    new = after['views'][name]
    for field in ['camera', 'world', 'statuses', 'counts']:
        assert old[field] == new[field], (name, field)
    assert [x['text'] for x in old['labels']] == [x['text'] for x in new['labels']], name
    report['viewsCompared'] += 1
    if name.startswith('flat-'):
        a = Image.open(p / 'before' / f'{name}.png').convert('RGB')
        b = Image.open(p / 'after' / f'{name}.png').convert('RGB')
        assert ImageChops.difference(a, b).getbbox() is None, name
        report['unchangedFlatImages'] += 1
    else:
        assert new['paint']['board'] == '0', name
        assert len(new['paint']['heroes']) == 36, name
        assert all(x['opacity'] == '0' for x in new['paint']['heroes']), name
view = after['views']['mount-opening']
report['storyLabels'] = len(view['labels'])
report['edgeIdentityElements'] = view['counts']['edges']
report['coveragePlants'] = view['paint']['coverage']
report['statuses'] = {kind: {s: sum(x['kind'] == kind and x['status'] == s for x in view['statuses']) for s in ['healthy', 'proposed']} for kind in ['territory', 'parcel']}
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
keys = ['pair-0-original-paint', 'pair-1-hero-removed', 'pair-2-board-removed']
sheet = Image.new('RGB', (1420, 350), '#faf7f0')
draw = ImageDraw.Draw(sheet)
for i, (key, label) in enumerate(zip(keys, ['Before: old paint', '1. Hero removed', '2. Empty board removed'])):
    v = finish['views'][key]
    for field in ['camera', 'world', 'statuses', 'counts']:
        assert v[field] == finish['views'][keys[0]][field], (key, field)
    assert v['paint']['board'] == ('0' if i == 2 else '1')
    assert all(h['opacity'] == ('1' if i == 0 else '0') for h in v['paint']['heroes'])
    crop = Image.open(p / 'finishing' / f'{key}.png').crop((660, 375, 1120, 675))
    crop.save(p / f'cleanup-step-{i}.png')
    sheet.paste(crop, (10 + i * 470, 40))
    draw.text((10 + i * 470, 10), label, font=font, fill='#26332b')
assert ImageChops.difference(Image.open(p/'cleanup-step-0.png'), Image.open(p/'cleanup-step-1.png')).getbbox()
assert ImageChops.difference(Image.open(p/'cleanup-step-1.png'), Image.open(p/'cleanup-step-2.png')).getbbox()
sheet.save(p/'cleanup-comparison.png')
report['isolatedPaintControlsVerified'] = True
sheet = Image.new('RGB', (1020, 430), '#faf7f0')
draw = ImageDraw.Draw(sheet)
for i, (key, title) in enumerate([('props-drive-machinery', 'A. Current coverage emphasis'), ('taste-quieter-coverage', 'B. Quieter coverage — preview only')]):
    v = finish['views'][key]
    for field in ['camera', 'world', 'statuses', 'counts']:
        assert v[field] == finish['views']['props-drive-machinery'][field], (key, field)
    assert v['paint']['coverage'] == finish['views']['props-drive-machinery']['paint']['coverage']
    crop = Image.open(p/'finishing'/f'{key}.png').crop((650, 290, 1150, 670))
    crop.save(p/f'taste-{i}.png')
    sheet.paste(crop,(10+i*510,40));draw.text((10+i*510,10), title, font=font, fill='#26332b')
sheet.save(p/'taste-options.png')
(p/'verification.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
