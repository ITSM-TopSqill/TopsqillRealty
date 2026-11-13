/**
 * The email sent for an alert (a message, an invitation, a lead). Pure, so it
 * can be tested without sending anything. Same look as the sign-in email.
 */
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Where each kind of alert opens on the website. */
export function alertPath(targetType?: string | null, targetId?: string | null): string {
  if (!targetType || !targetId) return "/notifications";
  switch (targetType) {
    case "conversation": return `/messages?c=${targetId}`;
    case "profile": return `/profile/${targetId}`;
    case "post": return `/posts/${targetId}`;
    case "listing": return `/listings/${targetId}`;
    case "lead": return `/leads?lead=${targetId}`;
    case "job": return `/jobs/${targetId}`;
    case "requirement": return `/requirements?r=${targetId}`;
    case "verification": return "/profile/verify";
    case "review": return "/admin/listings";
    case "campaign": return `/campaigns/${targetId}`;
    case "campaign-review": return "/admin/campaigns";
    case "wallet": return "/wallet";
    default: return "/notifications";
  }
}

const BUTTON: Record<string, string> = {
  message: "Reply", connection: "View profile", lead: "Open the lead", job: "View", match: "See the match", comment: "View the post", post: "View the post", system: "Open Topsqill.ai", listing: "View your listing", campaign: "Open the campaign",
};

export function renderAlertEmail(input: { kind: string; title: string; body?: string | null; url: string; name?: string | null; unsubscribeUrl?: string; settingsUrl?: string }) {
  const greeting = input.name ? `Hi ${input.name.split(" ")[0]},` : "Hi,";
  const button = BUTTON[input.kind] ?? "Open Topsqill.ai";
  const subject = input.title;
  const text = [greeting, "", input.title, input.body ? `\n${input.body}` : "", "", `${button}: ${input.url}`, "", "You get these emails for activity on your Topsqill.ai account.",
    input.unsubscribeUrl ? `Stop these emails: ${input.unsubscribeUrl}` : "", input.settingsUrl ? `Choose your emails: ${input.settingsUrl}` : "",
    "Topsqill.ai, the real estate network"].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  const links = [
    input.unsubscribeUrl ? `<a href="${escape(input.unsubscribeUrl)}" style="color:#8D8AA3">Stop these emails</a>` : "",
    input.settingsUrl ? `<a href="${escape(input.settingsUrl)}" style="color:#8D8AA3">Choose your emails</a>` : "",
  ].filter(Boolean).join(" · ");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#F5F4F9">
<div style="display:none;max-height:0;overflow:hidden">${escape(input.body ?? input.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #E6E3EE;overflow:hidden">
<tr><td style="height:6px;background:#8B4FEA;background-image:linear-gradient(115deg,#E5487A 0%,#8B4FEA 50%,#2F7FE6 100%)"></td></tr>
<tr><td style="padding:26px 28px 6px;font-family:Arial,Helvetica,sans-serif">
<div style="font:800 20px/1 Arial,Helvetica,sans-serif;color:#6A3FE0">Topsqill.ai</div></td></tr>
<tr><td style="padding:14px 28px 0;font-family:Arial,Helvetica,sans-serif;color:#1F1D33">
<p style="margin:0 0 12px;font-size:15px">${escape(greeting)}</p>
<p style="margin:0 0 8px;font-size:18px;font-weight:700;line-height:1.35">${escape(input.title)}</p>
${input.body ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#5F5C75;background:#F8F7FB;border-radius:12px;padding:12px 14px">${escape(input.body)}</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr><td style="border-radius:999px;background:#6A3FE0">
<a href="${escape(input.url)}" style="display:inline-block;padding:12px 24px;font:700 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:999px">${escape(button)}</a></td></tr></table>
</td></tr>
<tr><td style="padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8D8AA3;line-height:1.5">You get these emails for activity on your Topsqill.ai account.${links ? `<br>${links}` : ""}<br>Topsqill.ai, the real estate network</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
