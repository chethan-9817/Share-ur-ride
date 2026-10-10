"""
Email Verification Service
==========================
Handles email verification and OTP delivery for new user signups.
Keeps demo accounts intact with instant mock OTP ("1234").
"""

import smtplib
import secrets
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from ..config import settings

logger = logging.getLogger("arriveshare.email")

DEMO_EMAIL_DOMAIN = "@arriveshare.test"


def is_demo_email(email: str) -> bool:
    """Check if an email belongs to a pre-seeded demo user."""
    normalized = email.strip().lower()
    return normalized.endswith(DEMO_EMAIL_DOMAIN) or normalized == "test@test.com"


def generate_otp(length: int = 6) -> str:
    """Generate a cryptographically secure numeric OTP."""
    digits = [str(secrets.randbelow(10)) for _ in range(length)]
    return "".join(digits)


def build_email_template(recipient_name: str, otp_code: str) -> str:
    """Generate a sleek, responsive HTML email for ArriveShare verification."""
    first_name = recipient_name.split()[0] if recipient_name else "Traveler"
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your ArriveShare Account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0F0F1A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F8F8FF;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0F0F1A; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #1A1A2E; border-radius: 24px; border: 1px solid #2A2A4A; overflow: hidden; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; text-align: center; background: linear-gradient(135deg, rgba(108, 92, 231, 0.2) 0%, rgba(0, 210, 211, 0.1) 100%);">
              <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 16px; background: linear-gradient(135deg, #6C5CE7, #00D2D3); color: #FFFFFF; font-size: 24px; font-weight: bold; margin-bottom: 12px;">
                🚖
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #F8F8FF; letter-spacing: -0.5px;">
                ArriveShare
              </h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #B0B0CC;">
                Smart, Fair & Safe Ride-Pooling for Hub Arrivals
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; color: #F8F8FF;">
                Hello <strong>{first_name}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #B0B0CC;">
                Welcome to ArriveShare! To finish setting up your account and start sharing rides directly from airport terminals and railway stations, verify your email with the code below:
              </p>

              <!-- OTP Code Display -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; padding: 18px 36px; background-color: #16213E; border: 2px dashed #6C5CE7; border-radius: 16px; letter-spacing: 8px; font-size: 32px; font-weight: 800; color: #00D2D3; font-family: monospace;">
                      {otp_code}
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-size: 13px; text-align: center; color: #6C6C8A;">
                ⏱️ This verification code is valid for <strong>15 minutes</strong>.
              </p>

              <div style="border-top: 1px solid #2A2A4A; margin-top: 24px; padding-top: 20px;">
                <p style="margin: 0 0 6px 0; font-size: 12px; color: #B0B0CC;">
                  🛡️ <strong>Security Tip:</strong> Never share this OTP with anyone. ArriveShare representatives will never call or message you asking for your verification code.
                </p>
                <p style="margin: 0; font-size: 12px; color: #6C6C8A;">
                  If you didn't request this email, you can safely ignore it.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #131324; padding: 20px 32px; text-align: center; border-top: 1px solid #2A2A4A;">
              <p style="margin: 0; font-size: 11px; color: #6C6C8A;">
                © ArriveShare Platform · Kempegowda Airport & Railway Arrivals
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def send_verification_email(
    to_email: str,
    recipient_name: str,
    otp_code: str
) -> bool:
    """
    Send verification email via SMTP if configured.
    Falls back gracefully to console logging in development mode.

    Returns:
        True if email was dispatched or logged in dev mode.
    """
    # Always log the code to backend stdout for developer visibility
    print(f"\n[EMAIL SERVICE] ═══════════════════════════════════════════════════")
    print(f"[EMAIL SERVICE] Verification Code for {recipient_name} <{to_email}>: {otp_code}")
    print(f"[EMAIL SERVICE] ═══════════════════════════════════════════════════\n")

    if not settings.SMTP_ENABLED or not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        logger.info(
            f"SMTP is disabled or unconfigured. Verification OTP for {to_email} is {otp_code} (logged to console)."
        )
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Your ArriveShare Verification Code: {otp_code}"
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to_email

        plain_text = (
            f"Hello {recipient_name},\n\n"
            f"Your ArriveShare verification code is: {otp_code}\n\n"
            f"This code will expire in 15 minutes.\n"
            f"If you did not request this, please ignore this email.\n"
        )
        html_content = build_email_template(recipient_name, otp_code)

        msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        if settings.SMTP_PORT == 465:
            # SSL
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0) as server:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            # STARTTLS
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0) as server:
                if settings.SMTP_USE_TLS:
                    server.starttls()
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)

        logger.info(f"Verification email successfully dispatched to {to_email}")
        return True
    except Exception as exc:
        logger.error(f"Failed to dispatch SMTP email to {to_email}: {exc}")
        print(f"[EMAIL SERVICE] Warning: SMTP delivery failed ({exc}). Falling back to console OTP: {otp_code}")
        return False
