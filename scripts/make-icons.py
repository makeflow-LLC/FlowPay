#!/usr/bin/env python3
"""يولّد أيقونات التطبيق (الويب وأندرويد) من رمز الشعار في img/logo.png.

    python3 scripts/make-icons.py

شغّله فقط بعد تغيير الشعار. يحتاج Pillow.
"""
import os
from PIL import Image, ImageDraw

BG = (15, 23, 42, 255)      # --bg في app.css
RES = 'android/app/src/main/res'

logo = Image.open('img/logo.png').convert('RGBA')
# الرمز (∞) هو الجزء الأيسر من الشعار، قبل كلمة Flow
symbol = logo.crop((0, 0, 225, logo.height))
symbol = symbol.crop(symbol.getbbox())


def square(size, scale, radius=0):
    """رمز الشعار في وسط مربع داكن، يشغل `scale` من عرضه."""
    im = Image.new('RGBA', (size, size), BG)
    w = round(size * scale)
    h = round(w * symbol.height / symbol.width)
    s = symbol.resize((w, h), Image.LANCZOS)
    im.alpha_composite(s, ((size - w) // 2, (size - h) // 2))
    if radius:
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius * 4, fill=255)
        im.putalpha(mask.resize((size, size), Image.LANCZOS))
    return im


square(512, 0.72).save('icons/icon-512.png')
square(192, 0.72).save('icons/icon-192.png')
square(180, 0.72).save('icons/apple-touch-icon.png')
# القابلة للقص: المنطقة الآمنة دائرة قطرها 80%، فنصغّر الرمز داخلها
square(512, 0.55).save('icons/icon-maskable-512.png')
square(64, 0.8, radius=14).save('icons/favicon.png')

if os.path.isdir(RES):
    DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
    for name, k in DENSITIES.items():
        d = f'{RES}/mipmap-{name}'
        os.makedirs(d, exist_ok=True)
        # الأيقونة التكيفية: لوحة 108dp، والمنطقة الآمنة 66dp في وسطها
        square(round(108 * k), 0.42).save(f'{d}/ic_launcher_foreground.png')
        size = round(48 * k)
        square(size, 0.7, radius=round(size * 0.2)).save(f'{d}/ic_launcher.png')
        rnd = square(size, 0.62)
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size * 4, size * 4), fill=255)
        rnd.putalpha(mask.resize((size, size), Image.LANCZOS))
        rnd.save(f'{d}/ic_launcher_round.png')
    # شاشة البداية: الرمز في الوسط على الخلفية الداكنة
    for d in os.listdir(RES):
        p = f'{RES}/{d}/splash.png'
        if d.startswith('drawable') and os.path.exists(p):
            w, h = Image.open(p).size
            im = Image.new('RGBA', (w, h), BG)
            m = round(min(w, h) * 0.3)
            s = symbol.resize((m, round(m * symbol.height / symbol.width)), Image.LANCZOS)
            im.alpha_composite(s, ((w - s.width) // 2, (h - s.height) // 2))
            im.convert('RGB').save(p)
    print('android icons updated')
print('web icons updated')
