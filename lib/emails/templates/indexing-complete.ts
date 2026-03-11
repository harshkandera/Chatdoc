export function indexingCompleteEmail({
  firstName,
  productName,
  documentCount,
  chunkCount,
  type,
  workspaceUrl,
  appUrl = "https://www.thechatdoc.online",
}: {
  firstName: string;
  productName: string;
  documentCount?: number;
  chunkCount?: number;
  type: "index" | "reindex";
  workspaceUrl: string;
  appUrl?: string;
}): string {
  const logoUrl = `${appUrl}/log.png`;
  const isReindex = type === "reindex";
  const badge = isReindex ? "RE-INDEX COMPLETE" : "INDEXING COMPLETE";
  const headline = isReindex
    ? `${productName} has been updated.`
    : `${productName} is ready.`;
  const subtext = isReindex
    ? `Your re-index finished successfully. The latest docs are now live in your workspace — any changed pages have been re-embedded.`
    : `Your documentation workspace has been indexed and is ready to chat with. Ask anything about ${productName} and get source-backed answers instantly.`;

  const statsHtml =
    documentCount || chunkCount
      ? `
        <!-- Stats row -->
        <table cellpadding="0" cellspacing="0" border="0"
          style="width:100%;background:#111111;border:1px solid #1a1a1a;margin-bottom:32px;">
          <tr>
            ${
              documentCount
                ? `<td style="padding:20px 24px;border-right:1px solid #1a1a1a;width:50%;">
                <p style="margin:0 0 4px;font-family:monospace;font-size:10px;
                  letter-spacing:2px;text-transform:uppercase;color:#525252;">PAGES</p>
                <p style="margin:0;font-size:24px;font-weight:300;color:#ffffff;
                  letter-spacing:-0.5px;">${documentCount.toLocaleString()}</p>
              </td>`
                : ""
            }
            ${
              chunkCount
                ? `<td style="padding:20px 24px;width:50%;">
                <p style="margin:0 0 4px;font-family:monospace;font-size:10px;
                  letter-spacing:2px;text-transform:uppercase;color:#525252;">CHUNKS</p>
                <p style="margin:0;font-size:24px;font-weight:300;color:#ffffff;
                  letter-spacing:-0.5px;">${chunkCount.toLocaleString()}</p>
              </td>`
                : ""
            }
          </tr>
        </table>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${headline}</title>
</head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

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
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td style="vertical-align:middle;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:middle;padding-right:10px;">
                          <img src="${logoUrl}" width="52" height="28"
                            alt="ChatDoc" border="0"
                            style="display:block;border:0;outline:none;text-decoration:none;" />
                        </td>
                        <td style="vertical-align:middle;">
                          <span style="font-family:monospace;font-size:11px;letter-spacing:3px;
                            text-transform:uppercase;color:#10b981;">CHATDOC</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:4px 10px;
                      border:1px solid #10b981;background:rgba(16,185,129,0.08);
                      font-family:monospace;font-size:9px;letter-spacing:2px;
                      text-transform:uppercase;color:#10b981;">
                      ${badge}
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
                HEY ${firstName.toUpperCase()},
              </p>

              <h1 style="margin:0 0 20px;font-size:26px;font-weight:500;
                color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
                ${headline}
              </h1>

              <p style="margin:0 0 32px;font-size:15px;line-height:1.7;
                color:#a3a3a3;font-weight:300;">
                ${subtext}
              </p>

              ${statsHtml}

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td>
                    <a href="${workspaceUrl}"
                      style="display:inline-block;padding:14px 32px;background:#ffffff;
                        color:#000000;font-family:monospace;font-size:11px;
                        letter-spacing:2px;text-transform:uppercase;
                        text-decoration:none;font-weight:700;">
                      OPEN WORKSPACE
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;line-height:1.6;color:#525252;">
                Questions? Just reply to this email — we read everything.
              </p>

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
