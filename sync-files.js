const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const rootDir = __dirname;

// 0. Sync Fresh Client EXE if available
const srcExe = path.join(rootDir, 'client-electron', 'dist-build', 'UnioTechIT Setup 1.0.0.exe');
if (fs.existsSync(srcExe)) {
  fs.copyFileSync(srcExe, path.join(rootDir, 'UnioTechIT Setup 1.0.0.exe'));
  fs.copyFileSync(srcExe, path.join(rootDir, 'RemoteG Setup 1.0.0.exe'));
  console.log('✓ Copied fresh built UnioTechIT Setup 1.0.0.exe to root folder');
}

// 1. Sync clean frontend dist to all locations
const distDir = path.join(rootDir, 'controller-web', 'dist');
const serverPublic = path.join(rootDir, 'server', 'public');
const rootPublic = path.join(rootDir, 'public');

[serverPublic, rootPublic].forEach(targetDir => {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
  if (fs.existsSync(distDir)) {
    fs.cpSync(distDir, targetDir, { recursive: true });
  }
});
console.log('✓ Synced clean lightweight frontend dist to server/public and public');

// Ensure local full installer (76 MB) is available in public folders for direct instant download
const rootExe = path.join(rootDir, 'UnioTechIT Setup 1.0.0.exe');
if (fs.existsSync(rootExe)) {
  fs.copyFileSync(rootExe, path.join(serverPublic, 'UnioTechIT-Setup.exe'));
  fs.copyFileSync(rootExe, path.join(rootPublic, 'UnioTechIT-Setup.exe'));
  console.log('✓ Copied 76.6 MB full installer to server/public/UnioTechIT-Setup.exe');
}

// 2. Build Ultra-Lightweight cPanel Deployment Zip with AdmZip
const cpanelZipPath = path.join(rootDir, 'cpanel-deploy-light.zip');
if (fs.existsSync(cpanelZipPath)) fs.unlinkSync(cpanelZipPath);

const zip = new AdmZip();

// A. Add server directory (excluding node_modules, data, and binaries)
function addFolderToZip(folderPath, zipPathPrefix) {
  const items = fs.readdirSync(folderPath);
  for (const item of items) {
    if (item === 'node_modules' || item === 'data') continue;
    if (item.endsWith('.exe') || item.endsWith('.zip')) continue;

    const fullPath = path.join(folderPath, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      addFolderToZip(fullPath, `${zipPathPrefix}/${item}`);
    } else {
      zip.addLocalFile(fullPath, zipPathPrefix);
    }
  }
}

addFolderToZip(path.join(rootDir, 'server'), 'server');

// B. Add public directory (for Apache / public folder document roots)
addFolderToZip(distDir, 'public');

// C. Add dist files directly at root level of zip (for root document roots)
const distItems = fs.readdirSync(distDir);
for (const item of distItems) {
  const fullPath = path.join(distDir, item);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    addFolderToZip(fullPath, item);
  } else {
    zip.addLocalFile(fullPath, '');
  }
}

// D. Add root config files and server entry points
['package.json', 'app.js', '.htaccess', 'nixpacks.toml'].forEach(file => {
  const p = path.join(rootDir, file);
  if (fs.existsSync(p)) {
    zip.addLocalFile(p, '');
  }
});

// Also provide index.js, totp.js & email.js directly at root level for cPanel setups pointing to index.js
zip.addLocalFile(path.join(rootDir, 'server', 'index.js'), '');
zip.addLocalFile(path.join(rootDir, 'server', 'totp.js'), '');
zip.addLocalFile(path.join(rootDir, 'server', 'email.js'), '');

zip.writeZip(cpanelZipPath);

const sizeKb = (fs.statSync(cpanelZipPath).size / 1024).toFixed(1);
const sizeMb = (fs.statSync(cpanelZipPath).size / (1024 * 1024)).toFixed(2);
console.log(`\n🎉 Success! cpanel-deploy-light.zip created: ${sizeKb} KB (${sizeMb} MB)`);

// 3. Build All-in-One Full Deployment Bundle (Includes 76.6 MB UnioTechIT-Setup.exe inside)
const cpanelFullZipPath = path.join(rootDir, 'cpanel-full-bundle.zip');
if (fs.existsSync(cpanelFullZipPath)) fs.unlinkSync(cpanelFullZipPath);

const fullZip = new AdmZip(cpanelZipPath); // Clone base zip
if (fs.existsSync(rootExe)) {
  fullZip.addLocalFile(rootExe, '', 'UnioTechIT-Setup.exe');
  fullZip.addLocalFile(rootExe, 'public', 'UnioTechIT-Setup.exe');
  fullZip.writeZip(cpanelFullZipPath);
  const fullMb = (fs.statSync(cpanelFullZipPath).size / (1024 * 1024)).toFixed(2);
  console.log(`🎉 Success! cpanel-full-bundle.zip (with 76.6 MB EXE included) created: ${fullMb} MB`);
}
