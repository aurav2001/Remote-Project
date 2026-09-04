// Universal Root entry point for cPanel Phusion Passenger & Node.js Application Manager
const path = require('path');
const fs = require('fs');

if (fs.existsSync(path.join(__dirname, 'index.js'))) {
  require(path.join(__dirname, 'index.js'));
} else if (fs.existsSync(path.join(__dirname, 'server', 'index.js'))) {
  require(path.join(__dirname, 'server', 'index.js'));
} else {
  console.error('No valid index.js found in', __dirname);
}
