import os
import smtplib
from email.message import EmailMessage

from dotenv import load_dotenv
from langchain_core.tools import tool

load_dotenv()


@tool
def send_emails(recipients: list[str], subject: str, message: str) -> str:
    """Sends a plain-text email message to one or more recipients."""
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME") or os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS")
    sender = os.getenv("SMTP_FROM") or os.getenv("FROM_EMAIL") or smtp_username

    if not smtp_host or not smtp_username or not smtp_password or not sender:
        return "Email could not be sent: SMTP configuration is incomplete."

    cleaned_recipients = [recipient.strip() for recipient in recipients if recipient.strip()]
    if not cleaned_recipients:
        return "Email could not be sent: at least one recipient is required."

    email = EmailMessage()
    email["From"] = sender
    email["To"] = ", ".join(cleaned_recipients)
    email["Subject"] = subject
    email.set_content(message)

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(smtp_username, smtp_password)
            smtp.send_message(email)
    except (OSError, smtplib.SMTPException) as error:
        return f"Email could not be sent: {error}"

    return f"Email sent successfully to {len(cleaned_recipients)} recipient(s)."