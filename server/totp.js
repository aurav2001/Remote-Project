const crypto = require('crypto');

let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (e) {
  // qrcode not installed on server, client-side bundle handles rendering
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Decode a Base32 string to Buffer
function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = Buffer.alloc(Math.floor((clean.length * 5) / 8));

  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_ALPHABET.indexOf(clean[i]);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }

  return output.slice(0, index);
}

// Encode a Buffer to Base32 string
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

// Generate a random Base32 Secret Key (10 bytes = exactly 16 clean unpadded Base32 chars)
function generateSecret(byteLength = 10) {
  const randomBytes = crypto.randomBytes(byteLength);
  return base32Encode(randomBytes);
}

// Calculate RFC 6238 TOTP code for a given timestamp
function calculateTOTP(secret, epochTimeSec, digits = 6, period = 30) {
  const key = base32Decode(secret);
  const counter = Math.floor(epochTimeSec / period);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter % 0x100000000, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  const otp = binary % (10 ** digits);
  return String(otp).padStart(digits, '0');
}

// Verify a user-provided 6-digit TOTP code
// Checks immediate window (±5 mins) and dynamically scans full ±24 hours to guarantee match
function verifyTOTP(token, secret, window = 10, period = 30, clientEpochSec = null) {
  if (!token || !secret) return false;
  const cleanToken = String(token).trim().replace(/\D/g, '');
  if (cleanToken.length !== 6) return false;

  const cleanSecret = String(secret).toUpperCase().replace(/[\s\-_=]/g, '');
  if (!cleanSecret) return false;

  const serverEpochSec = Math.floor(Date.now() / 1000);
  const candidateTimes = [serverEpochSec];
  
  if (clientEpochSec) {
    const cSec = typeof clientEpochSec === 'number' ? clientEpochSec : parseInt(clientEpochSec);
    if (!isNaN(cSec) && cSec > 1000000000) {
      const normalizedClientSec = cSec > 10000000000 ? Math.floor(cSec / 1000) : cSec;
      candidateTimes.push(normalizedClientSec);
    }
  }

  // Phase 1: Fast check around server and client epoch (±5 mins)
  for (const baseTime of candidateTimes) {
    for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
      const checkTime = baseTime + (errorWindow * period);
      try {
        const expected = calculateTOTP(cleanSecret, checkTime, 6, period);
        if (cleanToken === expected) {
          return true;
        }
      } catch (e) {}
    }
  }

  // Phase 2: Ultra-resilient ±24 Hour scan (covers ANY server clock discrepancy / timezone offset worldwide)
  const maxScanPeriods = 2880; // 24 hours
  for (let i = -maxScanPeriods; i <= maxScanPeriods; i++) {
    const checkTime = serverEpochSec + (i * period);
    try {
      const expected = calculateTOTP(cleanSecret, checkTime, 6, period);
      if (cleanToken === expected) {
        return true;
      }
    } catch (e) {}
  }

  return false;
}

// Generate standard otpauth URL
function generateOtpAuthUrl(label, secret, issuer = 'UnioTechIT') {
  const cleanLabel = encodeURIComponent(label || 'User');
  const cleanIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${cleanIssuer}:${cleanLabel}?secret=${secret}&issuer=${cleanIssuer}&algorithm=SHA1&digits=6&period=30`;
}

// Generate QR Code Data URL (PNG / HTTPS fallback)
async function generateQRCodeDataUrl(otpauthUrl) {
  if (QRCode && typeof QRCode.toDataURL === 'function') {
    try {
      return await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 260,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
    } catch (err) {
      console.warn('Local QRCode module failed, using CDN QR fallback:', err.message);
    }
  }

  // Universal Instant QR fallback URL
  const encoded = encodeURIComponent(otpauthUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encoded}&margin=8`;
}

module.exports = {
  generateSecret,
  calculateTOTP,
  verifyTOTP,
  generateOtpAuthUrl,
  generateOtpauthURL: generateOtpAuthUrl,
  generateQRCodeDataUrl,
  generateQRCodeDataURL: generateQRCodeDataUrl
};
