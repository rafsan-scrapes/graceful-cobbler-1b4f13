/**
 * notify-view — tells you when a brand opens or acts on their Brokoby page.
 *
 * brand.html sends a tiny POST after a real person has interacted with the page
 * (never on link scanners, never on your own visits, never on demo pages).
 * This function checks the slug is real, then forwards one short message to a webhook.
 *
 * Environment variables (Netlify > Site configuration > Environment variables):
 *   NOTIFY_WEBHOOK_URL   required. Where messages go.
 *   NOTIFY_KIND          optional. discord (default) | slack | ntfy | generic
 *   NOTIFY_TZ            optional. e.g. Asia/Dhaka. Default UTC.
 *
 * Nothing is stored. No cookies. No email pixel involved.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EVENTS = {
  view: 'opened their page',
  cta_book: 'clicked "Book a call"',
  cta_reply_yes: 'clicked "Reply yes by email"',
  cta_email: 'clicked "Email us"',
  cta_media_kit: 'opened a media kit'
};

const json = (statusCode) => ({ statusCode }); // beacons never need a response body

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405);

  const hook = process.env.NOTIFY_WEBHOOK_URL;
  if (!hook) return json(204); // not configured yet: do nothing, break nothing

  if ((event.body || '').length > 2000) return json(413);
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400); }

  const { slug, event: ev, who } = body;
  if (typeof slug !== 'string' || slug.length > 60 || !SLUG_RE.test(slug) || !EVENTS[ev]) return json(400);

  // Only accept slugs that exist on this site, so nobody can spam your webhook with made-up names.
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  const proto = /^(localhost|127\.)/.test(host) ? 'http' : 'https';
  let brand = slug;
  try {
    const r = await fetch(`${proto}://${host}/data/brand/${slug}.json`);
    if (!r.ok) return json(404);
    const data = await r.json();
    if (data.demo) return json(204);
    brand = (data.brand && data.brand.name) || slug;
  } catch { return json(502); }

  const ua = event.headers['user-agent'] || '';
  const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';
  const country = event.headers['x-country'] || '';
  let when;
  try {
    when = new Date().toLocaleString('en-GB', { timeZone: process.env.NOTIFY_TZ || 'UTC', dateStyle: 'medium', timeStyle: 'short' });
  } catch { when = new Date().toISOString(); }

  const line = `${brand} ${EVENTS[ev]}${who ? ` (${String(who).slice(0, 60)})` : ''}`;
  const detail = [when, device, country].filter(Boolean).join(' · ');
  const text = `${line}\n${detail}\nbrokoby.com/brand/${slug}`;

  const kind = (process.env.NOTIFY_KIND || 'discord').toLowerCase();
  try {
    let res;
    if (kind === 'ntfy') {
      // ntfy header values must be plain ASCII, so no emoji in Title.
      res = await fetch(hook, { method: 'POST', headers: { Title: `Brokoby: ${brand}`.replace(/[^\x20-\x7E]/g, ''), Tags: ev === 'view' ? 'eyes' : 'white_check_mark' }, body: `${line}\n${detail}` });
    } else if (kind === 'slack') {
      res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    } else if (kind === 'generic') {
      res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, brand, event: ev, who: who || null, when, device, country, text }) });
    } else {
      res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `${ev === 'view' ? '👀' : '✅'} ${text}` }) });
    }
    if (!res.ok) console.error('[notify-view] webhook responded', res.status);
  } catch (e) {
    console.error('[notify-view] webhook failed', e.message);
  }
  return json(204);
};
