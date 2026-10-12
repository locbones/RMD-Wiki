"""Decode original inventory artwork without altering its colors or dimensions.

SpA1 layout checked against eezstreet/D2RModding-SpriteEdit and
dzik87/d2r-sprites. Pillow handles the standard BC3/DXT5 payload.
"""
import io
import json
import struct
import sys
from pathlib import Path
from PIL import Image

def sprite(data):
    if data[:4].lower() != b'spa1':
        raise ValueError('Unsupported sprite magic')
    version, frame_width = struct.unpack_from('<HH', data, 4)
    width, height = struct.unpack_from('<II', data, 8)
    frames = struct.unpack_from('<I', data, 20)[0]
    if not (0 < width <= 8192 and 0 < height <= 8192):
        raise ValueError('Invalid dimensions')
    payload = data[40:]
    if version == 31:
        if len(payload) < width * height * 4:
            raise ValueError('Truncated RGBA sprite')
        image = Image.frombytes('RGBA', (width, height), payload[:width * height * 4])
    elif version == 61:
        length = ((width + 3) // 4) * ((height + 3) // 4) * 16
        if len(payload) < length:
            raise ValueError('Truncated DXT5 sprite')
        header = struct.pack('<7I', 124, 0x81007, height, width, length, 0, 1)
        header += bytes(44)
        header += struct.pack('<II4s5I', 32, 4, b'DXT5', 0, 0, 0, 0, 0)
        header += struct.pack('<5I', 0x1000, 0, 0, 0, 0)
        image = Image.open(io.BytesIO(b'DDS ' + header + payload[:length])).convert('RGBA')
    else:
        raise ValueError(f'Unsupported sprite version {version}')
    if frames > 1 and frame_width > 0:
        image = image.crop((0, 0, frame_width, height))
    return image, {'version': version, 'frames': frames or 1, 'frame': 0}

def dc6(data, palette):
    version, flags, encoding, terminator, directions, frames = struct.unpack_from('<6I', data)
    if version != 6 or not directions or not frames:
        raise ValueError('Unsupported DC6 header')
    offset = struct.unpack_from('<I', data, 24)[0]
    flip, width, height, x_offset, y_offset, unknown, next_frame, length = struct.unpack_from('<8I', data, offset)
    pixels = bytearray(width * height * 4)
    source = data[offset + 32:offset + 32 + length]
    x, y, cursor = 0, height - 1 if not flip else 0, 0
    while cursor < len(source) and 0 <= y < height:
        token = source[cursor]; cursor += 1
        if token == 128:
            x = 0; y += 1 if flip else -1
        elif token & 128:
            x += token & 127
        else:
            for color in source[cursor:cursor + token]:
                if x < width and 0 <= y < height:
                    b, g, r = palette[color * 3:color * 3 + 3]
                    index = (y * width + x) * 4
                    pixels[index:index + 4] = bytes((r, g, b, 255))
                x += 1
            cursor += token
    return Image.frombytes('RGBA', (width, height), bytes(pixels)), {'version': version, 'frames': frames, 'frame': 0, 'format': 'DC6'}

def main():
    manifest_path = Path(sys.argv[1])
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    results = []
    palette = Path(manifest['palette']).read_bytes()
    for entry in manifest['assets']:
        source = Path(entry['path'])
        target = Path(entry['output'])
        try:
            image, details = dc6(source.read_bytes(), palette) if source.suffix.lower() == '.dc6' else sprite(source.read_bytes())
            target.parent.mkdir(parents=True, exist_ok=True)
            image.save(target, 'PNG', optimize=True)
            results.append({'key': entry['key'], 'width': image.width, 'height': image.height, **details})
        except Exception as error:
            results.append({'key': entry['key'], 'error': str(error)})
    manifest_path.with_suffix('.decoded.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    failures = [r for r in results if 'error' in r]
    print(f'Decoded {len(results) - len(failures)} of {len(results)} inventory assets')
    if failures:
        print(json.dumps(failures[:10], indent=2))
        sys.exit(1)

if __name__ == '__main__':
    main()
