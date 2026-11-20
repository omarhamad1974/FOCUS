"""Cut public/brand/logo.png into layers for the load splash (index.html).

Run once after the logo changes:  python3 scripts/splash-layers.py
Needs Pillow, numpy and scipy (dev only, not used by the app).
Writes public/brand/splash/*.png and prints each layer's box in logo pixels
(640 x 428), which index.html uses as percentages.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = Path('public/brand/logo.png')
OUT = Path('public/brand/splash')
BALL = (565, 108, 34)  # centre x, centre y, radius of the white ball in the logo

im = Image.open(SRC).convert('RGBA')
a = np.array(im)
r, g, b, al = (a[..., i].astype(int) for i in range(4))
op = al > 20
H, W = op.shape

masks = {
    'red': op & (r > 150) & (g < 110) & (b < 110),
    'navy': op & (b > r + 20) & (r < 60) & (b < 140),
    'blue': op & (b > r + 40) & (b >= 140),
}


def cores(mask):
    lab, n = ndimage.label(mask)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        size = int((lab[sl] == i + 1).sum())
        if size > 300:
            out.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, lab == i + 1))
    return out


def letter(x0):
    # Letters by left edge of their box: P, i (stem + dot), n, g, o.
    if x0 < 150: return 'p'
    if x0 < 210: return 'i'
    if x0 < 300: return 'n'
    if x0 < 480: return 'g'
    return 'o'


labels = np.zeros((H, W), np.int8)
names = ['', 'swoosh-red', 'swoosh-blue', 'paddle', 'p', 'i', 'n', 'g', 'o']
idx = {n: i for i, n in enumerate(names)}
for x0, y0, x1, y1, m in cores(masks['red']):
    labels[m] = idx['swoosh-red' if x1 < 380 else 'paddle']
for x0, y0, x1, y1, m in cores(masks['blue']):
    labels[m] = idx['swoosh-blue' if y0 > 250 else 'paddle']
for x0, y0, x1, y1, m in cores(masks['navy']):
    # The handle and the dark wave under the ball belong to the paddle.
    labels[m] = idx['paddle' if y0 < 190 else letter(x0)]
yy, xx = np.mgrid[0:H, 0:W]
ball = (xx - BALL[0]) ** 2 + (yy - BALL[1]) ** 2 <= BALL[2] ** 2
labels[ball & op] = idx['paddle']

# Give every other visible pixel (edges, shading) to the nearest layer.
_, (iy, ix) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
full = labels[iy, ix]
full[~(al > 0)] = 0

# The splash draws its own ball, so paint the logo's ball out of the paddle
# by repeatedly averaging the paddle colours around it.
pad = a.astype(float)
hole = ball.copy()
known = ~hole & (full == idx['paddle'])
pad[~known] = 0
for _ in range(400):
    acc = np.zeros_like(pad)
    cnt = np.zeros((H, W))
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        s = np.roll(np.roll(pad, dy, 0), dx, 1)
        k = np.roll(np.roll(known, dy, 0), dx, 1)
        acc += s * k[..., None]
        cnt += k
    fill = hole & (cnt > 0)
    pad[fill] = acc[fill] / cnt[fill][:, None]
    known = known | fill
paddle_px = a.copy()
paddle_px[hole] = pad[hole].round().astype(np.uint8)
paddle_px[hole, 3] = np.where(known[hole], paddle_px[hole, 3], 0)
full[hole & known] = idx['paddle']

OUT.mkdir(parents=True, exist_ok=True)
for name in names[1:]:
    m = full == idx[name]
    src = paddle_px if name == 'paddle' else a
    layer = np.zeros_like(a)
    layer[m] = src[m]
    ys, xs = np.nonzero(m)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    Image.fromarray(layer).crop(box).save(OUT / f'{name}.png', optimize=True)
    print(name, box)
