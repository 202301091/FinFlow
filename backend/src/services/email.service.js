import logger from '../config/logger.js';

/**
 * Core email dispatcher supporting Resend API and Brevo API free tiers.
 * Uses native fetch (zero additional npm dependencies).
 */
const sendEmail = async ({ toEmail, name = 'User', subject, htmlContent, logContext = 'Email' }) => {
  const resendApiKey = process.env.RESEND_API_KEY;
  const brevoApiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.EMAIL_FROM || 'FinFlow Security <onboarding@resend.dev>';

  // 1. Try Resend API (Free 3,000 emails/month, 100/day)
  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: senderEmail,
          to: [toEmail],
          subject,
          html: htmlContent,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Resend error code ${response.status}`);
      }

      logger.info({ emailId: data.id, toEmail }, `[EmailService] ${logContext} sent via Resend`);
      return { success: true, provider: 'resend', id: data.id };
    } catch (error) {
      logger.error({ err: error }, `[EmailService] Failed to send ${logContext} via Resend: ${error.message}`);
    }
  }

  // 2. Try Brevo API (Free 300 emails/day to any recipient)
  if (brevoApiKey) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'FinFlow Security', email: process.env.EMAIL_FROM || 'security@finflow.com' },
          to: [{ email: toEmail, name }],
          subject,
          htmlContent,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Brevo error code ${response.status}`);
      }

      logger.info({ messageId: data.messageId, toEmail }, `[EmailService] ${logContext} sent via Brevo`);
      return { success: true, provider: 'brevo', id: data.messageId };
    } catch (error) {
      logger.error({ err: error }, `[EmailService] Failed to send ${logContext} via Brevo: ${error.message}`);
    }
  }

  // 3. Fallback: Log email details to server terminal when API keys are not yet configured
  logger.warn(
    `[EmailService] No email API key (RESEND_API_KEY or BREVO_API_KEY) configured. ` +
    `To send real emails for free in production, set RESEND_API_KEY or BREVO_API_KEY in backend/.env. ` +
    `[${logContext} for ${toEmail}]`
  );

  return { success: true, provider: 'console', simulated: true };
};

/**
 * Send password reset email with 6-digit OTP code.
 */
export const sendPasswordResetEmail = async ({ toEmail, otp, name = 'FinFlow User' }) => {
  const subject = 'Your FinFlow Password Reset Code';
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
          .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
          .header { text-align: center; margin-bottom: 24px; }
          .logo { font-size: 24px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px; }
          .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 16px; margin-bottom: 8px; }
          .text { font-size: 14px; line-height: 1.6; color: #475569; margin: 8px 0; }
          .code-box { background: #f0f9ff; border: 2px dashed #38bdf8; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }
          .code { font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0369a1; }
          .expires { font-size: 12px; color: #64748b; margin-top: 8px; }
          .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
          .warning { font-size: 12px; color: #ef4444; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">FinFlow</div>
            <div class="title">Password Reset Request</div>
          </div>
          <p class="text">Hello <strong>${name}</strong>,</p>
          <p class="text">We received a request to reset the password for your FinFlow account. Use the 6-digit verification code below to complete your reset:</p>
          
          <div class="code-box">
            <div class="code">${otp}</div>
            <div class="expires">This code will expire in 15 minutes.</div>
          </div>

          <p class="text">If you did not request a password reset, you can safely ignore this email or contact support if you suspect unauthorized activity.</p>
          <p class="warning">⚠️ Never share this verification code with anyone. FinFlow will never ask for your code.</p>

          <div class="footer">
            &copy; ${new Date().getFullYear()} FinFlow. Secure Financial Transaction Platform.
          </div>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    toEmail,
    name,
    subject,
    htmlContent,
    logContext: `Password Reset OTP (${otp})`,
  });
};

/**
 * Send account registration verification email with 6-digit OTP code.
 */
export const sendRegistrationOtpEmail = async ({ toEmail, otp, name = 'FinFlow User' }) => {
  const subject = `Verify your FinFlow account: ${otp}`;
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
          .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
          .header { text-align: center; margin-bottom: 24px; }
          .logo { font-size: 24px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px; }
          .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 16px; margin-bottom: 8px; }
          .text { font-size: 14px; line-height: 1.6; color: #475569; margin: 8px 0; }
          .code-box { background: #f0fdf4; border: 2px dashed #4ade80; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }
          .code { font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #15803d; }
          .expires { font-size: 12px; color: #64748b; margin-top: 8px; }
          .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
          .warning { font-size: 12px; color: #64748b; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">FinFlow</div>
            <div class="title">Verify Your Email Address</div>
          </div>
          <p class="text">Welcome to FinFlow, <strong>${name}</strong>!</p>
          <p class="text">To complete your account creation and verify ownership of this email address, please enter the 6-digit verification code below:</p>
          
          <div class="code-box">
            <div class="code">${otp}</div>
            <div class="expires">This code will expire in 15 minutes.</div>
          </div>

          <p class="text">This verification ensures that only you can create an account using this email address.</p>
          <p class="warning">If you did not sign up for FinFlow, someone may have entered your email address by mistake. You can safely ignore this email.</p>

          <div class="footer">
            &copy; ${new Date().getFullYear()} FinFlow. Secure Financial Transaction Platform.
          </div>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    toEmail,
    name,
    subject,
    htmlContent,
    logContext: `Registration Verification OTP (${otp})`,
  });
};
