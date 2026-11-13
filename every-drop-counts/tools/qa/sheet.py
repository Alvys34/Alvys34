#!/usr/bin/env python3
"""Contact sheets from a persona run: python3 tools/qa/sheet.py <rawdir> <outprefix> [cols=4] [rows=4] [every=1] [start=0] [count=all] [tilew=480]"""
import json, sys, os, glob
from PIL import Image, ImageDraw, ImageFont
raw, outp = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
rows = int(sys.argv[4]) if len(sys.argv) > 4 else 4
every = int(sys.argv[5]) if len(sys.argv) > 5 else 1
start = int(sys.argv[6]) if len(sys.argv) > 6 else 0
count = int(sys.argv[7]) if len(sys.argv) > 7 else 10**9
tw = int(sys.argv[8]) if len(sys.argv) > 8 else 480
trace = json.load(open(os.path.join(raw, 'trace.json')))
frames = sorted(glob.glob(os.path.join(raw, 'f*.jpg')))
idx = list(range(start, min(len(frames), start + count), every))
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except Exception: font = ImageFont.load_default()
per = cols * rows; sheets = []
for si in range(0, len(idx), per):
    chunk = idx[si:si + per]
    im0 = Image.open(frames[chunk[0]]); th = int(im0.height * tw / im0.width)
    sheet = Image.new('RGB', (cols * tw, rows * (th + 22)), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for j, k in enumerate(chunk):
        im = Image.open(frames[k]).resize((tw, th))
        x, y = (j % cols) * tw, (j // cols) * (th + 22)
        sheet.paste(im, (x, y + 22))
        r = trace[k] if k < len(trace) else {}
        rot = r.get('rotIn', 0)
        arrow = '<<' if rot < -0.5 else '<' if rot < -0.05 else '>>' if rot > 0.5 else '>' if rot > 0.05 else '--'
        lab = f"t={r.get('t','?')} in={arrow}{' SLAM' if r.get('slamPress') else ''} w={r.get('omega','')} L={r.get('liters','')} k={r.get('kills','')} f={r.get('fill','')}"
        d.text((x + 4, y + 3), lab, fill=(255, 230, 120), font=font)
    name = f"{outp}-{len(sheets)+1:02d}.jpg"
    sheet.save(name, quality=80); sheets.append(name)
print('\n'.join(sheets))
