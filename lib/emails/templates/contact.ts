export function contactNotificationEmail({
  name,
  email,
  subject,
  message,
}: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>New Contact: ${subject}</title>
</head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background:#000;padding:48px 16px;">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="background:#0a0a0a;border:1px solid #1a1a1a;max-width:600px;width:100%;">

          <!-- Top accent line -->
          <tr>
            <td style="height:2px;background:linear-gradient(90deg,#10b981,#059669);"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:40px 48px 32px;">
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td>
                    <span style="font-family:monospace;font-size:11px;letter-spacing:3px;
                      text-transform:uppercase;color:#10b981;">CHATDOC</span>
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:4px 10px;
                      border:1px solid #525252;
                      font-family:monospace;font-size:9px;letter-spacing:2px;
                      text-transform:uppercase;color:#a3a3a3;">
                      NEW MESSAGE
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 48px;">
              <div style="height:1px;background:#1a1a1a;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px;">

              <p style="margin:0 0 8px;font-family:monospace;font-size:11px;
                letter-spacing:2px;text-transform:uppercase;color:#525252;">
                CONTACT FORM SUBMISSION
              </p>

              <h1 style="margin:0 0 32px;font-size:22px;font-weight:500;
                color:#ffffff;letter-spacing:-0.5px;line-height:1.3;">
                ${subject}
              </h1>

              <!-- Sender info -->
              <table cellpadding="0" cellspacing="0" border="0"
                style="width:100%;background:#111111;border:1px solid #1a1a1a;margin-bottom:32px;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #1a1a1a;">
                    <p style="margin:0 0 2px;font-family:monospace;font-size:9px;
                      letter-spacing:2px;text-transform:uppercase;color:#525252;">FROM</p>
                    <p style="margin:0;font-size:14px;color:#ffffff;">${name}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 2px;font-family:monospace;font-size:9px;
                      letter-spacing:2px;text-transform:uppercase;color:#525252;">EMAIL</p>
                    <p style="margin:0;font-size:14px;color:#10b981;">
                      <a href="mailto:${email}" style="color:#10b981;text-decoration:none;">${email}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Message -->
              <p style="margin:0 0 8px;font-family:monospace;font-size:9px;
                letter-spacing:2px;text-transform:uppercase;color:#525252;">MESSAGE</p>
              <div style="padding:20px;background:#111111;border:1px solid #1a1a1a;
                font-size:14px;line-height:1.7;color:#d4d4d4;white-space:pre-wrap;">
${message}
              </div>

            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 48px;">
              <div style="height:1px;background:#1a1a1a;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 48px 40px;">
              <p style="margin:0;font-family:monospace;font-size:10px;
                letter-spacing:1px;color:#404040;text-transform:uppercase;">
                CHATDOC — CONTACT FORM
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
