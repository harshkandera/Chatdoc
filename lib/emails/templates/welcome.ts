export function welcomeEmail({
  firstName,
  appUrl,
}: {
  firstName: string;
  appUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome to ChatDoc</title>
</head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background:#000;padding:48px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="background:#0a0a0a;border:1px solid #1a1a1a;max-width:600px;width:100%;">

          <!-- Top accent line -->
          <tr>
            <td style="height:2px;background:linear-gradient(90deg,#10b981,#059669);"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:40px 48px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-family:monospace;font-size:11px;letter-spacing:3px;
                      text-transform:uppercase;color:#10b981;">
                      CHATDOC
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
                WELCOME ABOARD
              </p>

              <h1 style="margin:0 0 24px;font-size:28px;font-weight:500;
                color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
                Hey ${firstName},<br/>glad you're here.
              </h1>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#a3a3a3;font-weight:300;">
                I built ChatDoc because I was tired of getting hallucinated answers from
                AI tools that didn't actually read the docs. ChatDoc indexes the real documentation
                and gives you source-backed answers — no guessing, no outdated info.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#a3a3a3;font-weight:300;">
                You're one of the early users and that genuinely means a lot. If you run
                into anything or have feedback, just reply to this email — I read every message personally.
              </p>

              <p style="margin:0 0 32px;font-size:15px;line-height:1.7;color:#a3a3a3;font-weight:300;">
                Here's how to get started:
              </p>

              <!-- Steps -->
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:32px;">
                <tr>
                  <td style="padding:0 0 16px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <span style="font-family:monospace;font-size:11px;color:#10b981;">01</span>
                        </td>
                        <td>
                          <p style="margin:0;font-size:14px;color:#d4d4d4;line-height:1.6;">
                            <strong style="color:#ffffff;font-weight:500;">Add a workspace</strong> — paste any official docs URL.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 16px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <span style="font-family:monospace;font-size:11px;color:#10b981;">02</span>
                        </td>
                        <td>
                          <p style="margin:0;font-size:14px;color:#d4d4d4;line-height:1.6;">
                            <strong style="color:#ffffff;font-weight:500;">Wait for indexing</strong> — we'll email you when it's ready.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <span style="font-family:monospace;font-size:11px;color:#10b981;">03</span>
                        </td>
                        <td>
                          <p style="margin:0;font-size:14px;color:#d4d4d4;line-height:1.6;">
                            <strong style="color:#ffffff;font-weight:500;">Start chatting</strong> — get precise answers from your indexed docs.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <a href="${appUrl}/chat"
                      style="display:inline-block;padding:14px 32px;background:#ffffff;
                        color:#000000;font-family:monospace;font-size:11px;
                        letter-spacing:2px;text-transform:uppercase;
                        text-decoration:none;font-weight:700;">
                      OPEN CHATDOC
                    </a>
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

          <!-- Footer -->
          <tr>
            <td style="padding:28px 48px 40px;">
              <p style="margin:0 0 4px;font-size:13px;color:#a3a3a3;">
                — Harsh Kandera
              </p>
              <p style="margin:0;font-family:monospace;font-size:10px;
                letter-spacing:1px;color:#404040;text-transform:uppercase;">
                CHATDOC — CHAT WITH YOUR DOCS, NOT THE WEB
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
