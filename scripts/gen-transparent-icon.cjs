const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const svgContent = fs.readFileSync(path.resolve(__dirname, '../assets/icon.svg'), 'utf-8');
  const tempHtml = path.resolve(__dirname, 'temp-transparent-icon.html');
  fs.writeFileSync(tempHtml, `<!DOCTYPE html>
<html>
<body style="margin:0; background:transparent; width:256px; height:256px;">
  <canvas id="c" width="256" height="256"></canvas>
  <script>
    const { ipcRenderer } = require('electron');
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');

    // 纯透明背景，不画任何矩形底色
    ctx.clearRect(0, 0, 256, 256);

    const svgBlob = new Blob([\`${svgContent}\`], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      // 居中绘制纯白/透明底的 SVG Logo
      ctx.drawImage(img, 8, 8, 240, 240);
      const dataUrl = canvas.toDataURL('image/png');
      ipcRenderer.send('icon-done', dataUrl);
    };
    img.src = blobURL;
  </script>
</body>
</html>`);

  const { ipcMain } = require('electron');
  ipcMain.once('icon-done', (event, dataUrl) => {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const pngBuffer = Buffer.from(base64Data, 'base64');
    
    // 写入 png 资源
    const pngPath = path.resolve(__dirname, '../assets/icon.png');
    fs.writeFileSync(pngPath, pngBuffer);
    fs.writeFileSync(path.resolve(__dirname, '../src-tauri/icons/32x32.png'), pngBuffer);
    fs.writeFileSync(path.resolve(__dirname, '../src-tauri/icons/128x128.png'), pngBuffer);
    fs.writeFileSync(path.resolve(__dirname, '../src-tauri/icons/128x128@2x.png'), pngBuffer);
    fs.writeFileSync(path.resolve(__dirname, '../src-tauri/icons/icon.png'), pngBuffer);
    
    // 生成透明标准的 icon.ico
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);

    const entry = Buffer.alloc(16);
    entry.writeUInt8(0, 0); // 256
    entry.writeUInt8(0, 1); // 256
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(pngBuffer.length, 8);
    entry.writeUInt32LE(22, 12);

    const icoData = Buffer.concat([header, entry, pngBuffer]);
    fs.writeFileSync(path.resolve(__dirname, '../src-tauri/icons/icon.ico'), icoData);
    
    console.log('Transparent PNG and ICO generated successfully!');
    try { fs.unlinkSync(tempHtml); } catch {}
    app.quit();
  });

  win.loadFile(tempHtml);
});
