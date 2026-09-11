let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  console.warn('[Email Warning]: nodemailer package is not yet installed on server. Click "Run NPM Install" in cPanel.');
}

// Load SMTP Configuration from environment variables
function getSmtpConfig() {
  const host = process.env.SMTP_HOST || '';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || `"UnioTechIT Control" <${user || 'no-reply@uniotechit.com'}>`;
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER || 'admin@uniotechit.com';

  const isConfigured = Boolean(nodemailer && host && user && pass);

  return {
    host,
    port,
    secure,
    auth: isConfigured ? { user, pass } : null,
    from,
    adminEmail,
    isConfigured,
    nodemailerAvailable: Boolean(nodemailer)
  };
}

// Create Nodemailer Transporter instance
function createTransporter() {
  if (!nodemailer) {
    console.warn('[Email]: nodemailer is not installed. Skipping email dispatch.');
    return null;
  }
  const cfg = getSmtpConfig();
  if (!cfg.isConfigured) {
    return null;
  }
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.auth.user,
      pass: cfg.auth.pass
    },
    tls: {
      rejectUnauthorized: false // Allow self-signed certs on cPanel mail servers
    }
  });
}

// Base HTML Email Template Layout
function wrapHtmlEmail({ title, preheader, contentHtml }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc; }
    .email-container { max-width: 600px; margin: 30px auto; background: #131b2e; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .email-header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 28px 30px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); text-align: center; }
    .brand-logo { font-size: 22px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; text-transform: uppercase; }
    .brand-logo span { color: #818cf8; }
    .email-body { padding: 32px 30px; }
    .greeting { font-size: 18px; font-weight: 700; color: #f8fafc; margin-bottom: 12px; }
    .desc-text { font-size: 15px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px; }
    .info-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); font-size: 14px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #94a3b8; font-weight: 600; }
    .info-val { color: #f8fafc; font-weight: 700; text-align: right; }
    .highlight-badge { display: inline-block; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 13px; }
    .btn-action { display: inline-block; background: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%); color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 15px; text-align: center; box-shadow: 0 4px 15px rgba(37, 99, 235, 0.4); margin: 10px 0; }
    .btn-action.success { background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); }
    .email-footer { background: #0b0f19; padding: 20px 30px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid rgba(255, 255, 255, 0.05); }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${preheader || title}
  </div>
  <div class="email-container">
    <div class="email-header">
      <div class="brand-logo">UnioTechIT <span>Control</span></div>
      <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Enterprise Remote Desktop & RMM Infrastructure</div>
    </div>
    <div class="email-body">
      ${contentHtml}
    </div>
    <div class="email-footer">
      <p style="margin: 0 0 6px 0;">This is an automated notification from UnioTechIT Signaling Server.</p>
      <p style="margin: 0;">© ${new Date().getFullYear()} UnioTechIT Architecture • All Rights Reserved.</p>
    </div>
  </div>
</body>
</html>
`;
}

// 1. Send Alert Email to SuperAdmin when a new company registers
async function sendAdminNewRegistrationAlert(user) {
  const cfg = getSmtpConfig();
  console.log(`[Email]: Preparing SuperAdmin alert for new company: ${user.companyName} (${user.email})`);

  if (!cfg.isConfigured) {
    console.warn('[Email Warning]: SMTP is not configured in .env. Skipping email dispatch (SMTP_HOST, SMTP_USER, SMTP_PASS required).');
    return { success: false, skipped: true, reason: 'SMTP not configured' };
  }

  const transporter = createTransporter();
  const contentHtml = `
    <div class="greeting">🔔 New Company Registration Received!</div>
    <p class="desc-text">A new organization has submitted a registration request on your Remote Desktop portal and is awaiting Administrator approval.</p>
    
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">Contact Person:</span>
        <span class="info-val">${user.name}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Company Name:</span>
        <span class="info-val"><span class="highlight-badge">🏢 ${user.companyName}</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">Official Email:</span>
        <span class="info-val">${user.email}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Phone / WhatsApp:</span>
        <span class="info-val">${user.phone}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Desktops / PCs Requested:</span>
        <span class="info-val">🖥️ ${user.desktopCount || '1-2 PCs'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Registered At:</span>
        <span class="info-val">${new Date().toLocaleString()}</span>
      </div>
    </div>

    <div style="text-align: center; margin-top: 24px;">
      <a href="https://remote.uniotechit.com" class="btn-action">
        Open Admin Console to Review & Approve ➔
      </a>
    </div>
  `;

  const html = wrapHtmlEmail({
    title: `New Company Lead: ${user.companyName}`,
    preheader: `New registration request from ${user.name} (${user.companyName})`,
    contentHtml
  });

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: cfg.adminEmail,
      subject: `🚨 [New Lead]: ${user.companyName} registered on Remote Desktop (${user.desktopCount || '1-2 PCs'})`,
      html
    });
    console.log('[Email Success]: SuperAdmin alert sent successfully. MessageId:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email Error]: Failed to send SuperAdmin alert:', err.message);
    return { success: false, error: err.message };
  }
}

// 2. Send Acknowledgment Email to Client after registration
async function sendClientRegistrationReceived(user) {
  const cfg = getSmtpConfig();
  if (!cfg.isConfigured || !user.email) return { success: false, skipped: true };

  const transporter = createTransporter();
  const contentHtml = `
    <div class="greeting">Hello ${user.name},</div>
    <p class="desc-text">Thank you for registering <strong>${user.companyName}</strong> on the UnioTechIT Enterprise Remote Desktop platform!</p>
    
    <div class="info-card">
      <div style="font-size: 14px; color: #38bdf8; font-weight: 700; margin-bottom: 8px;">📋 Your Application Status: PENDING APPROVAL</div>
      <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
        Your profile is currently under review by our administrative team. Once your company account is verified and approved, you will receive a confirmation email with instructions to log in and download the Host Agent software for your computers.
      </p>
    </div>

    <div class="info-card">
      <div class="info-row">
        <span class="info-label">Registered Company:</span>
        <span class="info-val">${user.companyName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Plan / Desktops:</span>
        <span class="info-val">${user.desktopCount || '1-2 PCs'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Registered Email:</span>
        <span class="info-val">${user.email}</span>
      </div>
    </div>

    <p style="font-size: 13px; color: #94a3b8;">Need urgent access? Feel free to contact our support team at <a href="mailto:${cfg.adminEmail}" style="color: #38bdf8;">${cfg.adminEmail}</a>.</p>
  `;

  const html = wrapHtmlEmail({
    title: 'Registration Received - UnioTechIT',
    preheader: 'Your company registration has been received and is under review.',
    contentHtml
  });

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: user.email,
      subject: `🎉 Registration Received: Welcome to UnioTechIT (${user.companyName})`,
      html
    });
    console.log('[Email Success]: Client registration acknowledgment sent to:', user.email);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email Error]: Failed sending client ack:', err.message);
    return { success: false, error: err.message };
  }
}

// 3. Send Approval Email to Client when Admin approves the account
async function sendClientAccountApproved(user) {
  const cfg = getSmtpConfig();
  if (!cfg.isConfigured || !user.email) return { success: false, skipped: true };

  const transporter = createTransporter();
  const contentHtml = `
    <div class="greeting">🎉 Congratulations ${user.name}!</div>
    <p class="desc-text">Your company account for <strong>${user.companyName}</strong> has been <strong>APPROVED</strong> by the Administrator. You now have full access to the Remote Desktop Control Suite.</p>
    
    <div class="info-card" style="background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.3);">
      <div style="font-size: 15px; color: #34d399; font-weight: 700; margin-bottom: 6px;">✅ Account Activated</div>
      <div style="font-size: 13px; color: #cbd5e1; line-height: 1.5;">
        You can now sign in using your registered email (<strong>${user.email}</strong>) and password to access your dedicated company fleet dashboard.
      </div>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="https://remote.uniotechit.com" class="btn-action success">
        🚀 Log In to Your Dashboard & Download Setup
      </a>
    </div>

    <div class="info-card">
      <div style="font-size: 14px; font-weight: 700; color: #f8fafc; margin-bottom: 10px;">⚡ Quick Setup Guide:</div>
      <ol style="margin: 0; padding-left: 20px; font-size: 13px; color: #94a3b8; line-height: 1.7;">
        <li>Log in to your dashboard at <a href="https://remote.uniotechit.com" style="color: #38bdf8;">remote.uniotechit.com</a>.</li>
        <li>Click <strong>Download Setup (.exe)</strong> and install on your target office computers.</li>
        <li>Your company code <strong>${user.companyName}</strong> will automatically pair with your dashboard.</li>
      </ol>
    </div>
  `;

  const html = wrapHtmlEmail({
    title: 'Account Approved - UnioTechIT',
    preheader: `Your account for ${user.companyName} is approved. Log in to start controlling computers.`,
    contentHtml
  });

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: user.email,
      subject: `✅ Account Approved: ${user.companyName} is Ready on UnioTechIT`,
      html
    });
    console.log('[Email Success]: Account approval email sent to:', user.email);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email Error]: Failed sending approval email:', err.message);
    return { success: false, error: err.message };
  }
}

// 4. Send Rejection / Denial Email to Client
async function sendClientAccountDenied(user) {
  const cfg = getSmtpConfig();
  if (!cfg.isConfigured || !user.email) return { success: false, skipped: true };

  const transporter = createTransporter();
  const contentHtml = `
    <div class="greeting">Hello ${user.name},</div>
    <p class="desc-text">Thank you for your interest in UnioTechIT Remote Desktop. We have reviewed your registration application for <strong>${user.companyName}</strong>.</p>
    
    <div class="info-card" style="background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.3);">
      <div style="font-size: 14px; color: #f87171; font-weight: 700; margin-bottom: 6px;">Application Status Update</div>
      <div style="font-size: 13px; color: #cbd5e1; line-height: 1.5;">
        At this time, we are unable to approve your registration request with the provided details.
      </div>
    </div>

    <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">
      If you believe this was in error or wish to submit updated organization credentials, please reply directly to this email or contact support at <a href="mailto:${cfg.adminEmail}" style="color: #38bdf8;">${cfg.adminEmail}</a>.
    </p>
  `;

  const html = wrapHtmlEmail({
    title: 'Registration Status - UnioTechIT',
    preheader: `Status update regarding your registration for ${user.companyName}.`,
    contentHtml
  });

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: user.email,
      subject: `Notice: UnioTechIT Registration Update (${user.companyName})`,
      html
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email Error]: Failed sending denial email:', err.message);
    return { success: false, error: err.message };
  }
}

// 5. Send Test Email (To verify SMTP setup from Admin Dashboard)
async function sendTestEmail(targetEmail) {
  const cfg = getSmtpConfig();
  if (!cfg.isConfigured) {
    return {
      success: false,
      error: 'SMTP Configuration Missing. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env file.'
    };
  }

  const transporter = createTransporter();
  const contentHtml = `
    <div class="greeting">✅ SMTP Mail Server Connected Successfully!</div>
    <p class="desc-text">This is a verified test email sent from your UnioTechIT Remote Desktop Signaling Server.</p>
    
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">SMTP Host:</span>
        <span class="info-val">${cfg.host}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Port & SSL:</span>
        <span class="info-val">${cfg.port} (${cfg.secure ? 'SSL' : 'TLS'})</span>
      </div>
      <div class="info-row">
        <span class="info-label">Sender Email:</span>
        <span class="info-val">${cfg.from}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Sent At:</span>
        <span class="info-val">${new Date().toLocaleString()}</span>
      </div>
    </div>
  `;

  const html = wrapHtmlEmail({
    title: 'SMTP Test Email - UnioTechIT',
    preheader: 'Your SMTP mail server is working properly.',
    contentHtml
  });

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: targetEmail || cfg.adminEmail,
      subject: '🧪 [SMTP Verified]: UnioTechIT Email Notifications Active',
      html
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  getSmtpConfig,
  sendAdminNewRegistrationAlert,
  sendClientRegistrationReceived,
  sendClientAccountApproved,
  sendClientAccountDenied,
  sendTestEmail
};
