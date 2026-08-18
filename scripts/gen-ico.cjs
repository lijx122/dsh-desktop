const fs = require('fs');
const path = require('path');

function createValidIcoFromPng(pngBuffer) {
  // ICO header: reserved(2 bytes) + type(2 bytes, 1=icon) + count(2 bytes, 1 icon)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  // Directory entry (16 bytes)
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width: 0 means 256
  entry.writeUInt8(0, 1); // height: 0 means 256
  entry.writeUInt8(0, 2); // color count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // size of image data
  entry.writeUInt32LE(22, 12); // offset of image data (6 header + 16 entry = 22)

  return Buffer.concat([header, entry, pngBuffer]);
}

const pngPath = path.resolve(__dirname, '../assets/icon.png');
const icoPath = path.resolve(__dirname, '../src-tauri/icons/icon.ico');

const pngData = fs.readFileSync(pngPath);
const icoData = createValidIcoFromPng(pngData);
fs.writeFileSync(icoPath, icoData);
console.log('Valid Windows ICO created, size:', icoData.length);
