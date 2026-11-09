/**
 * Email addresses and the sign-in code email.
 * Pure functions, so the format can be tested without sending anything.
 */

/** Lower-cased and trimmed, or null when it is not a plausible address. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  if (e.length < 6 || e.length > 160) return null;
  // One @, a dot in the domain, no spaces. Deliverability is proven by the code itself.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}

export type CodeEmail = { subject: string; text: string; html: string };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/**
 * The sign-in / sign-up code email. Table-based, inline-styled HTML because
 * that is what Gmail, Outlook and Apple Mail all render the same way, with a
 * plain-text part for clients that show no HTML.
 */
export function renderCodeEmail(input: { code: string; intent: "signin" | "signup"; minutes: number; name?: string }): CodeEmail {
  const { code, minutes } = input;
  const signup = input.intent === "signup";
  const greeting = input.name ? `Hi ${input.name.split(" ")[0]},` : "Hi,";
  const action = signup ? "finish creating your Topsqill.ai account" : "sign in to Topsqill.ai";
  const subject = `${code} is your Topsqill.ai ${signup ? "sign-up" : "sign-in"} code`;

  const text = [
    greeting,
    "",
    `Use this code to ${action}:`,
    "",
    `    ${code}`,
    "",
    `It expires in ${minutes} minutes and can be used once.`,
    "",
    "If you didn’t ask for this code, you can ignore this email. Nobody can sign in without it.",
    "Never share this code: Topsqill.ai will never ask you for it.",
    "",
    "Topsqill.ai, the real estate network",
  ].join("\n");

  const digits = code.split("").map((d) =>
    `<td style="padding:0 4px"><div style="width:42px;height:52px;line-height:52px;border-radius:10px;background:#F3F0FC;border:1px solid #E6E3EE;font:700 26px/52px 'Courier New',monospace;color:#1F1D33;text-align:center">${escape(d)}</div></td>`,
  ).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#F5F4F9">
<div style="display:none;max-height:0;overflow:hidden">Your code is ${escape(code)}. It expires in ${minutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F9;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #E6E3EE;overflow:hidden">
<tr><td style="height:6px;background:#8B4FEA;background-image:linear-gradient(115deg,#E5487A 0%,#8B4FEA 50%,#2F7FE6 100%)"></td></tr>
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:30px;height:30px;border-radius:8px;background:#6A3FE0;color:#fff;font:800 18px/30px Arial,sans-serif;text-align:center">t</td>
<td style="padding-left:8px;font:800 18px Arial,sans-serif;color:#1F1D33">Topsqill.ai</td>
</tr></table>
</td></tr>
<tr><td style="padding:12px 28px 0;font-family:Arial,Helvetica,sans-serif;color:#1F1D33">
<p style="margin:0 0 6px;font-size:16px">${escape(greeting)}</p>
<p style="margin:0;font-size:15px;line-height:1.5;color:#4A4760">Use this code to ${escape(action)}:</p>
</td></tr>
<tr><td align="center" style="padding:22px 20px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table>
</td></tr>
<tr><td style="padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#6B6880">
<p style="margin:0 0 10px">It expires in <b>${minutes} minutes</b> and can be used once.</p>
<p style="margin:0">If you didn’t ask for this code, you can ignore this email. Nobody can sign in without it. Never share it: Topsqill.ai will never ask you for it.</p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #EEECF4;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9A97AD">
Topsqill.ai, the real estate network
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}
