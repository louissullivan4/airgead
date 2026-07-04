// Branded transactional email. Every email the app sends goes through
// sendEmail so they all share one clean, mobile-friendly layout that matches
// the app theme (white card on grey, purple wordmark and button - the colour
// values mirror the tokens in frontend/src/app/globals.css).
//
// The transport is created per send, NOT at module load, so tests can stub
// nodemailer.createTransport. Every send carries a plaintext body alongside
// the HTML for clients (and tests) that only read text.
const nodemailer = require('nodemailer');
const { BRAND } = require('../config/brand');

// Mirrors --primary and the zinc greys in frontend/src/app/globals.css.
const COLORS = {
    primary: '#8a3ffc',
    heading: '#18181b',
    body: '#3f3f46',
    muted: '#71717a',
    border: '#e4e4e7',
    background: '#f4f4f5',
    card: '#ffffff',
};

const FONT_STACK =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// Escaped paragraph HTML; user-supplied newlines survive as <br>.
const paragraphHtml = (text) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.body};">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;

// Table-based layout with inline styles only - the lowest common denominator
// email clients render reliably.
const renderEmail = ({ heading, paragraphs = [], cta = null, footerNote = null }) => {
    const ctaHtml = cta
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
            <tr>
              <td style="border-radius:8px;background-color:${COLORS.primary};">
                <a href="${escapeHtml(cta.url)}" target="_blank"
                   style="display:inline-block;padding:12px 24px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                  ${escapeHtml(cta.label)}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:${COLORS.muted};">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${escapeHtml(cta.url)}" style="color:${COLORS.primary};word-break:break-all;">${escapeHtml(cta.url)}</a>
          </p>`
        : '';

    const footer = footerNote
        ? `${escapeHtml(footerNote)}<br>`
        : '';

    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:${COLORS.background};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.background};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;">
            <tr>
              <td style="padding:28px 32px 0;font-family:${FONT_STACK};">
                <span style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.primary};">${escapeHtml(BRAND)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 24px;font-family:${FONT_STACK};">
                <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:${COLORS.heading};">${escapeHtml(heading)}</h1>
                ${paragraphs.map(paragraphHtml).join('\n                ')}
                ${ctaHtml}
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${COLORS.muted};">
            ${footer}&copy; ${escapeHtml(BRAND)}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

// Sends a branded email. `text` is the required plaintext fallback and must
// contain any action link, so text-only clients still get a working email.
const sendEmail = async ({ to, subject, heading, paragraphs = [], cta = null, footerNote = null, text }) => {
    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    return transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USERNAME}>`,
        to,
        subject,
        text,
        html: renderEmail({ heading, paragraphs, cta, footerNote }),
    });
};

module.exports = { sendEmail, renderEmail };
