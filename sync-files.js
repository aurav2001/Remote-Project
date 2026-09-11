const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

const rootDir = __dirname;
const versionFile = path.join(rootDir, 'version.json');

// --- Helper Functions for Version Management ---
function readCurrentVersion() {
  if (fs.existsSync(versionFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      if (data.version) return data.version.replace(/^v/, '');
    } catch (e) {}
  }
  return '1.1.1';
}

function bumpSemver(ver, type = 'patch') {
  const parts = ver.split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (type === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (type === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    // patch
    parts[2] += 1;
  }
  return parts.join('.');
}

// Parse Command Line Arguments
const args = process.argv.slice(2);
let targetVersion = readCurrentVersion();

const bumpArg = args.find(a => a.startsWith('--bump') || a === 'bump');
const noBumpArg = args.includes('--no-bump');
const directVerArg = args.find(a => /^[vV]?\d+\.\d+\.\d+/.test(a));

if (directVerArg) {
  targetVersion = directVerArg.replace(/^v/, '');
} else if (!noBumpArg) {
  let bumpType = 'patch';
  if (bumpArg && bumpArg.includes('=')) {
    bumpType = bumpArg.split('=')[1];
  }
  targetVersion = bumpSemver(targetVersion, bumpType);
}

// Ensure version.json is updated
fs.writeFileSync(versionFile, JSON.stringify({ version: targetVersion }, null, 2), 'utf8');

// Synchronize all package.json files
const syncPackageJson = (pkgPath) => {
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.version = targetVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }
};

syncPackageJson(path.join(rootDir, 'package.json'));
syncPackageJson(path.join(rootDir, 'client-electron', 'package.json'));
syncPackageJson(path.join(rootDir, 'controller-web', 'package.json'));

const version = `v${targetVersion}`;
const dateStr = new Date().toISOString().slice(0, 10);

console.log(`\n======================================================`);
console.log(`🚀 Automated Multi-Package & Distribution Pipeline`);
console.log(`📦 Active Release Target: ${version} (Date: ${dateStr})`);
console.log(`======================================================\n`);

// 1. Build Client Electron Installer if not present or explicit --build-client
const clientDistDir = path.join(rootDir, 'client-electron', 'dist-build');
const clientExeName = `UnioTechIT Setup ${targetVersion}.exe`;
const srcExe = path.join(clientDistDir, clientExeName);

const shouldBuildClient = !fs.existsSync(srcExe) || args.includes('--build-client') || args.includes('--all');
if (shouldBuildClient) {
  console.log(`⚡ Step 1: Building Electron Client installer (${clientExeName})...`);
  execSync('npm run package', { cwd: path.join(rootDir, 'client-electron'), stdio: 'inherit' });
} else {
  console.log(`⚡ Step 1: Using existing compiled installer: ${clientExeName}`);
}

// Copy versioned and root EXE
if (fs.existsSync(srcExe)) {
  const rootVersionedExe = path.join(rootDir, `UnioTechIT-v${targetVersion}-Setup.exe`);
  const rootNamedExe = path.join(rootDir, clientExeName);
  const rootLatestExe = path.join(rootDir, 'UnioTechIT Setup 1.0.0.exe');
  
  fs.copyFileSync(srcExe, rootVersionedExe);
  fs.copyFileSync(srcExe, rootNamedExe);
  fs.copyFileSync(srcExe, rootLatestExe);
  
  // Create a standalone zip of the client installer for direct sharing
  const clientZip = new AdmZip();
  clientZip.addLocalFile(srcExe, '', `UnioTechIT Setup ${targetVersion}.exe`);
  const clientZipVersioned = path.join(rootDir, `UnioTechIT-v${targetVersion}-Setup.zip`);
  const clientZipLatest = path.join(rootDir, 'UnioTechIT-Setup.zip');
  clientZip.writeZip(clientZipVersioned);
  fs.copyFileSync(clientZipVersioned, clientZipLatest);
  
  console.log(`✓ Generated client artifacts:`);
  console.log(`   - ${clientExeName}`);
  console.log(`   - UnioTechIT-v${targetVersion}-Setup.exe`);
  console.log(`   - UnioTechIT-v${targetVersion}-Setup.zip`);
}

// 2. Build fresh Controller Web Frontend
console.log('\n⚡ Step 2: Building Controller Web frontend (Vite)...');
execSync('npm run build', { cwd: path.join(rootDir, 'controller-web'), stdio: 'inherit' });

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
console.log('✓ Synced clean frontend dist to server/public and public');

// Helper to add recursive directory excluding junk and unwanted binaries
function addFolderToZip(zipInstance, folderPath, zipPathPrefix, excludeExe = true) {
  if (!fs.existsSync(folderPath)) return;
  const items = fs.readdirSync(folderPath);
  const ignoredNames = new Set([
    'node_modules',
    'dist-build',
    'win-unpacked',
    'dist',
    'data',
    '.git',
    '.gemini',
    '.vscode',
    '.idea'
  ]);

  for (const item of items) {
    if (ignoredNames.has(item)) continue;
    if (item.endsWith('.zip')) continue;
    if (excludeExe && item.endsWith('.exe')) continue;

    const fullPath = path.join(folderPath, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      addFolderToZip(zipInstance, fullPath, zipPathPrefix ? `${zipPathPrefix}/${item}` : item, excludeExe);
    } else {
      zipInstance.addLocalFile(fullPath, zipPathPrefix || '');
    }
  }
}

// 4. Build Ultra-Lightweight cPanel Deployment Zip (excl. 76MB EXE)
console.log('\n⚡ Step 3: Packaging cPanel Lightweight Deployment Bundle...');
const lightZip = new AdmZip();

// Server files (excluding any copied EXE)
addFolderToZip(lightZip, path.join(rootDir, 'server'), 'server', true);

// Public files from dist
addFolderToZip(lightZip, distDir, 'public', true);

// Root frontend assets for direct document root upload
const distItems = fs.readdirSync(distDir);
for (const item of distItems) {
  const fullPath = path.join(distDir, item);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    addFolderToZip(lightZip, fullPath, item, true);
  } else {
    lightZip.addLocalFile(fullPath, '');
  }
}

// Root config files
['package.json', 'app.js', '.htaccess', 'nixpacks.toml', '.env.example', 'version.json'].forEach(file => {
  const p = path.join(rootDir, file);
  if (fs.existsSync(p)) {
    lightZip.addLocalFile(p, '');
  }
});

// Root entry points for cPanel Node.js selector
lightZip.addLocalFile(path.join(rootDir, 'server', 'index.js'), '');
lightZip.addLocalFile(path.join(rootDir, 'server', 'totp.js'), '');
lightZip.addLocalFile(path.join(rootDir, 'server', 'email.js'), '');

const cpanelLightVersioned = path.join(rootDir, `cpanel-deploy-light-${version}.zip`);
const cpanelLightLatest = path.join(rootDir, 'cpanel-deploy-light.zip');

lightZip.writeZip(cpanelLightVersioned);
fs.copyFileSync(cpanelLightVersioned, cpanelLightLatest);

const lightMb = (fs.statSync(cpanelLightVersioned).size / (1024 * 1024)).toFixed(2);
console.log(`🎉 Created Versioned Archive: cpanel-deploy-light-${version}.zip (${lightMb} MB)`);
console.log(`🎉 Created Latest Pointer:    cpanel-deploy-light.zip`);

// 5. Now place installer in public folders for direct web downloads on host
if (fs.existsSync(srcExe)) {
  fs.copyFileSync(srcExe, path.join(serverPublic, 'UnioTechIT-Setup.exe'));
  fs.copyFileSync(srcExe, path.join(rootPublic, 'UnioTechIT-Setup.exe'));
  fs.copyFileSync(srcExe, path.join(rootPublic, `UnioTechIT-v${targetVersion}-Setup.exe`));
  console.log('✓ Copied installer to web public download endpoints');
}

// 6. Build Full cPanel Deployment Bundle with Host Installer (NEW file for each version!)
console.log('\n⚡ Step 4: Packaging cPanel Full Bundle with Host Installer...');
const fullZip = new AdmZip(cpanelLightVersioned);
if (fs.existsSync(srcExe)) {
  fullZip.addLocalFile(srcExe, '', 'UnioTechIT-Setup.exe');
  fullZip.addLocalFile(srcExe, 'public', 'UnioTechIT-Setup.exe');
  fullZip.addLocalFile(srcExe, 'server/public', 'UnioTechIT-Setup.exe');
}

const cpanelFullVersioned = path.join(rootDir, `cpanel-full-bundle-${version}.zip`);
const cpanelFullLatest = path.join(rootDir, 'cpanel-full-bundle.zip');

fullZip.writeZip(cpanelFullVersioned);
fs.copyFileSync(cpanelFullVersioned, cpanelFullLatest);

const fullMb = (fs.statSync(cpanelFullVersioned).size / (1024 * 1024)).toFixed(2);
console.log(`🎉 Created Versioned Archive: cpanel-full-bundle-${version}.zip (${fullMb} MB)`);
console.log(`🎉 Created Latest Pointer:    cpanel-full-bundle.zip`);

// 7. Build Clean Source Code Backup Zip (Pure source code, excludes build dirs & node_modules)
console.log('\n⚡ Step 5: Packaging Pure Source Code Backup...');
const srcZip = new AdmZip();

['client-electron', 'controller-web', 'server'].forEach(dir => {
  const p = path.join(rootDir, dir);
  if (fs.existsSync(p)) {
    addFolderToZip(srcZip, p, dir, false);
  }
});

['package.json', 'app.js', '.htaccess', 'nixpacks.toml', '.env.example', 'PROJECT_SUMMARY.md', 'version.json'].forEach(file => {
  const p = path.join(rootDir, file);
  if (fs.existsSync(p)) {
    srcZip.addLocalFile(p, '');
  }
});

const srcBackupPath = path.join(rootDir, `SOURCE_BACKUP_${version}_${dateStr}.zip`);
srcZip.writeZip(srcBackupPath);
const srcMb = (fs.statSync(srcBackupPath).size / (1024 * 1024)).toFixed(2);
console.log(`🎉 Created Versioned Source:  SOURCE_BACKUP_${version}_${dateStr}.zip (${srcMb} MB)`);

console.log(`\n======================================================`);
console.log(`✨ All Build Packages for ${version} Successfully Created!`);
console.log(`📦 Output Files:`);
console.log(`   1. cpanel-deploy-light-${version}.zip (${lightMb} MB)`);
console.log(`   2. cpanel-full-bundle-${version}.zip (${fullMb} MB)`);
console.log(`   3. SOURCE_BACKUP_${version}_${dateStr}.zip (${srcMb} MB)`);
if (fs.existsSync(srcExe)) {
  console.log(`   4. UnioTechIT Setup ${targetVersion}.exe`);
  console.log(`   5. UnioTechIT-v${targetVersion}-Setup.exe`);
  console.log(`   6. UnioTechIT-v${targetVersion}-Setup.zip`);
}
console.log(`======================================================\n`);
