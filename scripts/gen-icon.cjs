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
  const tempHtml = path.resolve(__dirname, 'temp-icon.html');
  fs.writeFileSync(tempHtml, `<!DOCTYPE html>
<html>
<body style="margin:0; background:transparent; width:256px; height:256px;">
  <canvas id="c" width="256" height="256"></canvas>
  <script>
    const { ipcRenderer } = require('electron');
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');

    // Draw background rounded rect
    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(16, 16, 224, 224, 48);
    ctx.fill();

    const svgBlob = new Blob([\`${svgContent}\`], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 48, 48, 160, 160);
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
    const pngPath = path.resolve(__dirname, '../assets/icon.png');
    fs.writeFileSync(pngPath, Buffer.from(base64Data, 'base64'));
    console.log('High-res PNG icon created successfully, size:', fs.statSync(pngPath).size);
    try { fs.unlinkSync(tempHtml); } catch {}
    app.quit();
  });

  win.loadFile(tempHtml);
});
