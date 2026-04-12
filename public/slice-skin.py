"""
Slices yomHaAtzmaut-skin.png into individual background assets.
Run: python slice-skin.py
Output goes into: public/skin/
"""
from PIL import Image
import os

img = Image.open('yomHaAtzmaut-skin.png')
W, H = img.width, img.height   # 1024 x 1536
print(f'Source image: {W}x{H}')

os.makedirs('skin', exist_ok=True)

slices = {
    # Full-width header (wooden scroll + Jerusalem + Star of David tile border)
    'header-bg.png':        (0,    0,    W,    370),
    # Full-width drum bar (three parchment day-picker panels)
    'drum-bg.png':          (0,    370,  W,    490),
    # Single parchment card crop (centre of weather row)
    'weather-card-bg.png':  (340,  580,  685,  765),
    # Full wave row — each cell shows a different third via background-position
    'wave-row-bg.png':      (0,    770,  W,    980),
    # Full wind row
    'wind-row-bg.png':      (0,    980,  W,    1085),
    # Bunting strip (blue-and-white flags)
    'bunting-bg.png':       (0,    1085, W,    1135),
    # Left sun tile — Jerusalem sunset with bunting
    'sunset-bg.png':        (0,    1135, 512,  1290),
    # Right sun tile — Galilee sunrise
    'sunrise-bg.png':       (512,  1135, W,    1290),
}

for name, box in slices.items():
    crop = img.crop(box)
    path = f'skin/{name}'
    crop.save(path)
    print(f'  {name}: {crop.width}x{crop.height}')

print('Done.')
