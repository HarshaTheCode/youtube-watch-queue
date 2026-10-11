const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 implementation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function createPng(width, height, pixelFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makePngChunk('IHDR', ihdrData);

  // Scanlines (filter byte 0 + RGBA per pixel)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makePngChunk('IDAT', compressedData);
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate sleek YouTube-styled Bookmark icon:
// A rounded red square with a crisp white bookmark ribbon
function drawBookmarkIcon(x, y, size) {
  const normalizedX = x / size;
  const normalizedY = y / size;

  // Background rounded rectangle
  const pad = 0.08;
  const radius = 0.22;
  const inBoxX = normalizedX >= pad && normalizedX <= 1 - pad;
  const inBoxY = normalizedY >= pad && normalizedY <= 1 - pad;

  let inBadge = false;
  if (inBoxX && inBoxY) {
    const leftX = pad + radius;
    const rightX = 1 - pad - radius;
    const topY = pad + radius;
    const bottomY = 1 - pad - radius;

    if (normalizedX < leftX && normalizedY < topY) {
      const dist = Math.hypot(normalizedX - leftX, normalizedY - topY);
      inBadge = dist <= radius;
    } else if (normalizedX > rightX && normalizedY < topY) {
      const dist = Math.hypot(normalizedX - rightX, normalizedY - topY);
      inBadge = dist <= radius;
    } else if (normalizedX < leftX && normalizedY > bottomY) {
      const dist = Math.hypot(normalizedX - leftX, normalizedY - bottomY);
      inBadge = dist <= radius;
    } else if (normalizedX > rightX && normalizedY > bottomY) {
      const dist = Math.hypot(normalizedX - rightX, normalizedY - bottomY);
      inBadge = dist <= radius;
    } else {
      inBadge = true;
    }
  }

  if (!inBadge) {
    return [0, 0, 0, 0]; // Transparent
  }

  // Bookmark shape (white)
  // Left: 0.32, Right: 0.68, Top: 0.22, Notch tip: y=0.62, Bottom wings: y=0.76
  const bmLeft = 0.32;
  const bmRight = 0.68;
  const bmTop = 0.22;
  const bmBottom = 0.76;
  const bmCenter = 0.50;
  const bmNotchY = 0.62;

  let inBookmark = false;
  if (normalizedX >= bmLeft && normalizedX <= bmRight && normalizedY >= bmTop && normalizedY <= bmBottom) {
    // Check the triangle cutout at the bottom
    const relX = Math.abs(normalizedX - bmCenter) / (bmRight - bmCenter); // 0 at center, 1 at edges
    const cutY = bmNotchY + relX * (bmBottom - bmNotchY);
    if (normalizedY <= cutY) {
      inBookmark = true;
    }
  }

  if (inBookmark) {
    return [255, 255, 255, 255]; // Pure white bookmark
  }

  // YouTube Red: #FF0000 or #E50914 (YouTube uses #FF0000)
  return [255, 0, 0, 255];
}

const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 32, 48, 128].forEach((size) => {
  const buf = createPng(size, size, (x, y) => drawBookmarkIcon(x, y, size));
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), buf);
  console.log(`Generated icon-${size}.png (${size}x${size})`);
});
