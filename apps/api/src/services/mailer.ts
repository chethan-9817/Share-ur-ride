import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../config/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Last N mails — handy in tests and the dev console. */
export const outbox: Mail[] = [];

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  outbox.push(mail);
  if (outbox.length > 50) outbox.shift();

  const t = getTransport();
  if (!t) {
    if (!isTest) console.info(`\n📧 [mail:console] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return { delivered: false };
  }
  try {
    await t.sendMail({ from: env.MAIL_FROM, ...mail });
    return { delivered: true };
  } catch (err) {
    console.error('mail delivery failed', err);
    return { delivered: false };
  }
}

const shell = (title: string, body: string) => `<!doctype html>
<html><body style="margin:0;background:#f4f4f7;font-family:Inter,Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden">
        <tr><td style="background:#4f46e5;color:#fff;padding:20px 24px;font-size:18px;font-weight:700">
          🚖 ArriveShare
        </td></tr>
        <tr><td style="padding:24px">
          <h2 style="margin:0 0 12px;font-size:20px;color:#111827">${title}</h2>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px">
          In an emergency always call <b>112</b> (India) or the Women Helpline <b>1091</b>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export const templates = {
  otp(code: string) {
    return {
      subject: `${code} is your ArriveShare sign-in code`,
      text: `Your ArriveShare code is ${code}. It expires in ${env.OTP_TTL_MIN} minutes. Never share it with anyone — ArriveShare staff will never ask for it.`,
      html: shell(
        'Your sign-in code',
        `<p style="color:#374151">Use this code to finish signing in. It expires in ${env.OTP_TTL_MIN} minutes.</p>
         <p style="font-size:34px;letter-spacing:10px;font-weight:800;color:#4f46e5;margin:20px 0">${code}</p>
         <p style="color:#6b7280;font-size:13px">Never share this code. ArriveShare staff will never ask for it.</p>`,
      ),
    };
  },

  tripShared(riderName: string, link: string, vehicle: string | null) {
    return {
      subject: `${riderName} shared a live ArriveShare trip with you`,
      text: `${riderName} is travelling with ArriveShare and added you as a trusted contact.\nFollow the trip live: ${link}${vehicle ? `\nVehicle: ${vehicle}` : ''}`,
      html: shell(
        `${riderName} is sharing their trip`,
        `<p style="color:#374151">${riderName} added you as a trusted contact. You can follow the cab live until they reach home.</p>
         ${vehicle ? `<p style="color:#374151">Vehicle: <b>${vehicle}</b></p>` : ''}
         <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Follow live trip</a></p>`,
      ),
    };
  },

  sos(riderName: string, link: string, where: string, vehicle: string | null) {
    return {
      subject: `🚨 SOS from ${riderName} — please check on them now`,
      text: `${riderName} triggered an SOS alert on ArriveShare.\nLast known location: ${where}\n${vehicle ? `Vehicle: ${vehicle}\n` : ''}Live trip: ${link}\nIf you cannot reach them, call 112 immediately.`,
      html: shell(
        `🚨 ${riderName} needs help`,
        `<p style="color:#b91c1c;font-weight:600">${riderName} triggered an SOS alert.</p>
         <p style="color:#374151">Last known location: <a href="${where}">${where}</a></p>
         ${vehicle ? `<p style="color:#374151">Vehicle: <b>${vehicle}</b></p>` : ''}
         <p><a href="${link}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Open live trip</a></p>
         <p style="color:#374151">If you cannot reach them, call <b>112</b> immediately.</p>`,
      ),
    };
  },

  checkInMissed(riderName: string, link: string, reason: string) {
    return {
      subject: `${riderName} hasn't responded to a safety check`,
      text: `ArriveShare noticed: ${reason}. We asked ${riderName} to confirm they're safe and haven't heard back. Live trip: ${link}`,
      html: shell(
        `Safety check-in missed`,
        `<p style="color:#374151">We noticed: <b>${reason}</b>. We asked ${riderName} to confirm they are safe and haven't heard back yet.</p>
         <p><a href="${link}" style="display:inline-block;background:#d97706;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Open live trip</a></p>`,
      ),
    };
  },
};
