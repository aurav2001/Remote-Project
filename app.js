// Root entry point for cPanel Phusion Passenger & Node.js Application Manager
const path = require('path');

// Launch the main signaling server & static web controller
require(path.join(__dirname, 'server', 'index.js'));
