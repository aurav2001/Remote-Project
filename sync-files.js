const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

const rootDir = __dirname;
const version = 'v1.1.0';
const dateStr = new Date().toISOString().slice(0, 10); // '2026-09-11'

console.log(`\n========================================`);
console.log(`🚀 Building Distribution & cPanel Packages`);
console.log(`📦 Release Version: ${version} (${dateStr})`);
console.log(`========================================\n`);

// 1. Build fresh frontend dist
console.log('⚡ Step 1: Building Controller Web frontend (Vite)...');
execSync('npm run build', { cwd: path.join(rootDir, 'controller-web'), stdio: 'inherit' });

// 2. Sync Client EXE if available
const srcExe = path.join(rootDir, 'client-electron', 'dist-build', 'UnioTechIT Setup 1.0.0.exe');
if (fs.existsSync(srcExe)) {
  fs.copyFileSync(srcExe, path.join(rootDir, 'UnioTechIT Setup 1.0.0.exe'));
  fs.copyFileSync(srcExe, path.join(rootDir, 'RemoteG Setup 1.0.0.exe'));
  console.log('✓ Copied fresh built UnioTechIT Setup 1.0.0.exe to root folder');
}

// 3. Sync clean frontend dist to server/public and root public
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

// Ensure installer is in public folders for direct web downloads
const rootExe = path.join(rootDir, 'UnioTechIT Setup 1.0.0.exe');
if (fs.existsSync(rootExe)) {
  fs.copyFileSync(rootExe, path.join(serverPublic, 'UnioTechIT-Setup.exe'));
  fs.copyFileSync(rootExe, path.join(rootPublic, 'UnioTechIT-Setup.exe'));
  console.log('✓ Copied 76.6 MB full installer to public download endpoints');
}

// Helper to add recursive directory excluding junk
function addFolderToZip(zipInstance, folderPath, zipPathPrefix) {
  const items = fs.readdirSync(folderPath);
  for (const item of items) {
    if (item === 'node_modules' || item === 'data' || item === '.git' || item === '.gemini') continue;
    if (item.endsWith('.exe') || item.endsWith('.zip')) continue;

    const fullPath = path.join(folderPath, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      addFolderToZip(zipInstance, fullPath, `${zipPathPrefix}/${item}`);
    } else {
      zipInstance.addLocalFile(fullPath, zipPathPrefix);
    }
  }
}

// 4. Build Ultra-Lightweight cPanel Deployment Zip
console.log('\n⚡ Step 2: Packaging cPanel Lightweight Deployment Bundle...');
const lightZip = new AdmZip();

// Server files
addFolderToZip(lightZip, path.join(rootDir, 'server'), 'server');

// Public files
addFolderToZip(lightZip, distDir, 'public');

// Root frontend assets for direct document root
const distItems = fs.readdirSync(distDir);
for (const item of distItems) {
  const fullPath = path.join(distDir, item);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    addFolderToZip(lightZip, fullPath, item);
  } else {
    lightZip.addLocalFile(fullPath, '');
  }
}

// Root config files
['package.json', 'app.js', '.htaccess', 'nixpacks.toml', '.env.example'].forEach(file => {
  const p = path.join(rootDir, file);
  if (fs.existsSync(p)) {
    lightZip.addLocalFile(p, '');
  }
});

// Root entry points for cPanel Node.js selector
lightZip.addLocalFile(path.join(rootDir, 'server', 'index.js'), '');
lightZip.addLocalFile(path.join(rootDir, 'server', 'totp.js'), '');
lightZip.addLocalFile(path.join(rootDir, 'server', 'email.js'), '');

const cpanelLightVersioned = path.join(rootDir, `cpanel-deploy-light-${version}-${dateStr}.zip`);
const cpanelLightLatest = path.join(rootDir, 'cpanel-deploy-light.zip');

lightZip.writeZip(cpanelLightVersioned);
fs.copyFileSync(cpanelLightVersioned, cpanelLightLatest);

const lightMb = (fs.statSync(cpanelLightLatest).size / (1024 * 1024)).toFixed(2);
console.log(`🎉 Created: cpanel-deploy-light-${version}-${dateStr}.zip (${lightMb} MB)`);
console.log(`🎉 Created: cpanel-deploy-light.zip (Latest alias)`);

// 5. Build Full cPanel Deployment Bundle with 76.6 MB EXE included
console.log('\n⚡ Step 3: Packaging cPanel Full Bundle with Host Installer...');
const fullZip = new AdmZip(cpanelLightLatest);
if (fs.existsSync(rootExe)) {
  fullZip.addLocalFile(rootExe, '', 'UnioTechIT-Setup.exe');
  fullZip.addLocalFile(rootExe, 'public', 'UnioTechIT-Setup.exe');
}

const cpanelFullVersioned = path.join(rootDir, `cpanel-full-bundle-${version}-${dateStr}.zip`);
const cpanelFullLatest = path.join(rootDir, 'cpanel-full-bundle.zip');

fullZip.writeZip(cpanelFullVersioned);
fs.copyFileSync(cpanelFullVersioned, cpanelFullLatest);

const fullMb = (fs.statSync(cpanelFullLatest).size / (1024 * 1024)).toFixed(2);
console.log(`🎉 Created: cpanel-full-bundle-${version}-${dateStr}.zip (${fullMb} MB)`);
console.log(`🎉 Created: cpanel-full-bundle.zip (Latest alias)`);

// 6. Build Clean Source Code Backup Zip
console.log('\n⚡ Step 4: Packaging Pure Source Code Backup...');
const srcZip = new AdmZip();

['client-electron', 'controller-web', 'server'].forEach(dir => {
  const p = path.join(rootDir, dir);
  if (fs.existsSync(p)) {
    addFolderToZip(srcZip, p, dir);
  }
});

['package.json', 'app.js', '.htaccess', 'nixpacks.toml', '.env.example', 'PROJECT_SUMMARY.md'].forEach(file => {
  const p = path.join(rootDir, file);
  if (fs.existsSync(p)) {
    srcZip.addLocalFile(p, '');
  }
});

const srcBackupPath = path.join(rootDir, `SOURCE_BACKUP_${version}_LOCKSCREEN_${dateStr}.zip`);
srcZip.writeZip(srcBackupPath);
const srcMb = (fs.statSync(srcBackupPath).size / (1024 * 1024)).toFixed(2);
console.log(`🎉 Created: SOURCE_BACKUP_${version}_LOCKSCREEN_${dateStr}.zip (${srcMb} MB)`);

console.log(`\n========================================`);
console.log(`✨ All Distribution Builds & Zips Ready!`);
console.log(`========================================\n`);
