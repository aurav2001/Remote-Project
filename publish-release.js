const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = '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';
const OWNER = 'aurav2001';
const REPO = 'Remote-Project';
const TAG = 'v1.0.0';

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function createRelease() {
  console.log('1. Checking or creating GitHub Release v1.0.0...');
  
  const getRes = await makeRequest({
    hostname: 'api.github.com',
    path: `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`,
    method: 'GET',
    headers: {
      'User-Agent': 'RemoteG-Publisher',
      'Authorization': `token ${GITHUB_TOKEN}`
    }
  });

  let release = null;
  if (getRes.statusCode === 200) {
    console.log('Existing release v1.0.0 found!');
    release = getRes.body;
  } else {
    const createRes = await makeRequest({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/releases`,
      method: 'POST',
      headers: {
        'User-Agent': 'RemoteG-Publisher',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      tag_name: TAG,
      name: 'RemoteG Host Setup v1.0.0',
      body: 'Production installer for RemoteG Host Client.',
      draft: false,
      prerelease: false
    }));

    if (createRes.statusCode === 201 || createRes.statusCode === 200) {
      console.log('Successfully created release v1.0.0!');
      release = createRes.body;
    } else {
      console.error('Failed to create release:', createRes.body);
      return;
    }
  }

  const uploadUrlTemplate = release.upload_url;
  const uploadHost = 'uploads.github.com';
  const basePath = uploadUrlTemplate.split('{')[0].replace('https://uploads.github.com', '');

  const filesToUpload = [
    {
      filePath: path.join(__dirname, 'client-electron/RemoteG-Setup.zip'),
      assetName: 'RemoteG-Setup.zip',
      contentType: 'application/zip'
    },
    {
      filePath: path.join(__dirname, 'client-electron/dist-build/RemoteG Setup 1.0.0.exe'),
      assetName: 'RemoteG-Setup.exe',
      contentType: 'application/octet-stream'
    }
  ];

  for (const fileObj of filesToUpload) {
    if (!fs.existsSync(fileObj.filePath)) {
      console.warn(`File missing at path: ${fileObj.filePath}`);
      continue;
    }

    const fileSizeMb = (fs.statSync(fileObj.filePath).size / (1024 * 1024)).toFixed(2);
    console.log(`\nUploading asset ${fileObj.assetName} (${fileSizeMb} MB)...`);

    if (release.assets && release.assets.length > 0) {
      const existingAsset = release.assets.find(a => a.name === fileObj.assetName);
      if (existingAsset) {
        console.log(`Deleting existing asset ID ${existingAsset.id}...`);
        await makeRequest({
          hostname: 'api.github.com',
          path: `/repos/${OWNER}/${REPO}/releases/assets/${existingAsset.id}`,
          method: 'DELETE',
          headers: {
            'User-Agent': 'RemoteG-Publisher',
            'Authorization': `token ${GITHUB_TOKEN}`
          }
        });
      }
    }

    const fileBuffer = fs.readFileSync(fileObj.filePath);
    const uploadPath = `${basePath}?name=${encodeURIComponent(fileObj.assetName)}`;

    const uploadRes = await makeRequest({
      hostname: uploadHost,
      path: uploadPath,
      method: 'POST',
      headers: {
        'User-Agent': 'RemoteG-Publisher',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': fileObj.contentType,
        'Content-Length': fileBuffer.length
      }
    }, fileBuffer);

    if (uploadRes.statusCode === 201 || uploadRes.statusCode === 200) {
      console.log(`✅ Successfully uploaded ${fileObj.assetName}! Download URL: ${uploadRes.body.browser_download_url}`);
    } else {
      console.error(`❌ Failed to upload ${fileObj.assetName}:`, uploadRes.body);
    }
  }

  console.log('\n🎉 ALL RELEASE ASSETS UPLOADED SUCCESSFULLY!');
}

createRelease().catch(err => console.error('Error:', err));
