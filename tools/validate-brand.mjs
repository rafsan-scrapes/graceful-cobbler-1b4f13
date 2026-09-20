#!/usr/bin/env node
/**
 * Validates a brand page data file before it goes live.
 *
 *   node tools/validate-brand.mjs data/brand/acme-x7k2.json
 *
 * Exit code 0 = safe to deploy (warnings may remain). Exit code 1 = fix the errors first.
 * Run from the site root (the folder that contains brand.html).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/validate-brand.mjs data/brand/<slug>.json'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [], warns = [];
const E = m => errors.push(m), W = m => warns.push(m);

let raw, d;
try { raw = fs.readFileSync(file, 'utf8'); d = JSON.parse(raw); } catch (e) { console.error('✗ Cannot read or parse JSON:', e.message); process.exit(1); }

/* ---------- helpers ---------- */
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const str = v => typeof v === 'string' && v.trim().length > 0;
const httpsUrl = v => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const ytChannel = v => httpsUrl(v) && /youtube\.com\/(@[\w.\-]+|channel\/[\w-]+|c\/[\w.\-]+|user\/[\w.\-]+)/i.test(v);
const ytVideoId = v => { try { const x = new URL(v); const h = x.hostname.replace(/^www\.|^m\./, ''); let id = null; if (h === 'youtu.be') id = x.pathname.slice(1).split('/')[0]; else if (h.endsWith('youtube.com')) id = x.searchParams.get('v') || (x.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1]; return id && /^[\w-]{11}$/.test(id) ? id : null; } catch { return null; } };
const ym = v => /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(v || '');
const monthIndex = v => { const [y, m] = v.split('-').map(Number); return y * 12 + m; };
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const walk = (o, fn, p = '') => { if (Array.isArray(o)) o.forEach((v, i) => walk(v, fn, `${p}[${i}]`)); else if (isObj(o)) Object.entries(o).forEach(([k, v]) => walk(v, fn, p ? `${p}.${k}` : k)); else fn(o, p); };
const needNum = (v, p, { min = 0, req = false } = {}) => { if (v === undefined) { if (req) E(`${p} is required`); return false; } if (!isNum(v)) { E(`${p} must be a plain number (got ${JSON.stringify(v)}). Write 212000, not "212K".`); return false; } if (v < min) { E(`${p} must be at least ${min}`); return false; } return true; };

/* ---------- top level ---------- */
const slug = path.basename(file, '.json');
if (d.slug !== slug) E(`"slug" (${d.slug}) must equal the file name (${slug})`);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 6 || slug.length > 60) E('slug must be lowercase letters, digits and hyphens, 6 to 60 chars, e.g. acme-x7k2');
if (!slug.startsWith('demo') && !/-[a-z0-9]{4}$/.test(slug)) W('slug should end with a 4-character random suffix so the link cannot be guessed (e.g. acme-x7k2)');
if (d.demo === true && !slug.startsWith('demo')) E('"demo": true on a real brand page. Remove it or set it to false.');

/* ---------- scans over every string ---------- */
const LEAK = /\b(commission|rate\s?card|our\s+fee|agency\s+fee|retainer|mark-?up|cpm)\b|\$\s?[\d,.]+\s?k?\s?(\/|per|for an?)\s?(video|integration|sponsorship|post)/i;
const PLACEHOLDER = /\{\{|\}\}|\[\[|\]\]|\bTODO\b|\bTBD\b|lorem ipsum|PLACEHOLDER|\bXXX+\b|\bN\/A\b/i;
const NEWNESS = /\b(new agency|we'?re new|just launched|starting out|early[- ]stage agency|no track record|first clients?)\b/i;
walk(d, (v, p) => {
  if (typeof v !== 'string') return;
  if (LEAK.test(v)) E(`${p}: mentions commission, fees or rates. Those must never appear on the page.`);
  if (PLACEHOLDER.test(v)) E(`${p}: looks like an unfilled placeholder ("${v.slice(0, 40)}")`);
  if (NEWNESS.test(v)) W(`${p}: frames Brokoby as new. Brokoby is presented as established.`);
  if (d.demo !== true && /\bsample\b/i.test(v)) E(`${p}: contains the word "sample" (leftover demo text)`);
  if (/^\/assets\//.test(v) && !fs.existsSync(path.join(root, v))) E(`${p}: file not found on disk: ${v}`);
  if (/^https:\/\/.*\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(v)) W(`${p}: hotlinked image. Save it under /assets/brands/${slug}/ so it cannot break.`);
});

/* ---------- brand ---------- */
const b = d.brand;
if (!isObj(b)) E('brand is required'); else {
  if (!str(b.name)) E('brand.name is required');
  if (b.website && !httpsUrl(b.website)) E('brand.website must be a full https URL');
  if (b.customer_value_usd !== undefined) { needNum(b.customer_value_usd, 'brand.customer_value_usd', { min: 1 }); if (!str(b.customer_value_basis)) E('brand.customer_value_basis is required when customer_value_usd is set. Show the arithmetic in words.'); }
  if (!b.logo) W('brand.logo missing. The page will show a letter instead of the logo.');
}

/* ---------- research ---------- */
const r = d.research;
if (!isObj(r)) E('research is required'); else {
  if (!['recent', 'lapsed', 'case_study'].includes(r.mode)) E('research.mode must be "recent", "lapsed" or "case_study"');
  if (!str(r.source)) E('research.source is required (e.g. "SponsorRadar")');
  if (!ym(r.as_of)) E('research.as_of must be YYYY-MM (the month the research was checked)');
  const chans = r.channels;
  if (!Array.isArray(chans) || !chans.length) E('research.channels needs at least one channel');
  else chans.forEach((c, i) => {
    const p = `research.channels[${i}]`;
    if (!ytChannel(c.url)) E(`${p}.url must be a YouTube channel URL (https://www.youtube.com/@handle)`);
    if (c.subscribers !== undefined) needNum(c.subscribers, `${p}.subscribers`, { min: 1 });
    if (c.times_sponsored !== undefined) needNum(c.times_sponsored, `${p}.times_sponsored`, { min: 1 });
    if (!c.name) W(`${p}.name missing. The page will show the @handle.`);
  });
  if (r.total_sponsorships_found !== undefined) needNum(r.total_sponsorships_found, 'research.total_sponsorships_found', { min: 1 });
  const fv = r.featured_video;
  if (fv !== undefined) {
    if (!ytVideoId(fv.url)) E('research.featured_video.url is not a valid YouTube video link');
    if (fv.views !== undefined) needNum(fv.views, 'research.featured_video.views', { min: 1 });
    if (fv.published !== undefined && !ym(fv.published)) E('research.featured_video.published must be YYYY-MM');
  }
  if (r.mode === 'recent' || r.mode === 'lapsed') {
    if (!fv) W('research.featured_video missing. The page will show the channel list without a video.');
    if (r.competitor || r.estimated_revenue_usd) E('competitor / estimated_revenue_usd belong to case_study mode only');
  }
  if (r.mode === 'recent' && fv && ym(fv.published) && ym(r.as_of) && monthIndex(r.as_of) - monthIndex(fv.published) > 2)
    W('mode is "recent" but the featured video is more than 2 months older than as_of. Should this be "lapsed"?');
  if (r.mode === 'lapsed') {
    if (!ym(r.last_sponsored_month)) E('research.last_sponsored_month (YYYY-MM) is required for lapsed mode');
    else if (ym(r.as_of) && monthIndex(r.as_of) - monthIndex(r.last_sponsored_month) < 2) E('mode is "lapsed" but last_sponsored_month is less than 2 months before as_of. Use "recent".');
  }
  if (r.mode === 'case_study') {
    if (!isObj(r.competitor) || !str(r.competitor.name)) E('research.competitor.name is required for case_study mode');
    else if (b && r.competitor.name.trim().toLowerCase() === String(b.name).trim().toLowerCase()) E('competitor cannot be the brand itself');
    if (Array.isArray(chans) && chans.length !== 2) W('case_study usually shows exactly 2 channels');
    const est = r.estimated_revenue_usd;
    if (!isObj(est)) E('research.estimated_revenue_usd {low, high} is required for case_study mode');
    else { needNum(est.low, 'estimated_revenue_usd.low', { min: 1, req: true }); needNum(est.high, 'estimated_revenue_usd.high', { min: 1, req: true }); if (isNum(est.low) && isNum(est.high) && est.low > est.high) E('estimated_revenue_usd.low is greater than high'); }
    if (!str(r.estimate_method) || r.estimate_method.length < 60) E('research.estimate_method must explain how the estimate was made (at least a couple of sentences, with the inputs in words)');
    if (!Array.isArray(r.estimate_sources) || !r.estimate_sources.length || !r.estimate_sources.every(s => httpsUrl(s.url))) E('research.estimate_sources needs at least one {label, url} with an https URL');
  }
}

/* ---------- creators ---------- */
const cs = d.creators;
if (!Array.isArray(cs) || !cs.length) E('creators needs at least one creator'); else {
  if (cs.length > 3) E('creators: maximum is 3'); if (cs.length !== 2) W(`creators: expected 2, found ${cs.length}`);
  cs.forEach((c, i) => {
    const p = `creators[${i}]`;
    if (!str(c.name)) W(`${p}.name missing. The page will show the @handle.`);
    if (!ytChannel(c.channel_url)) E(`${p}.channel_url must be a YouTube channel URL`);
    needNum(c.subscribers, `${p}.subscribers`, { min: 1, req: true });
    const v = c.recent_video_views;
    if (!Array.isArray(v)) E(`${p}.recent_video_views must be an array of view counts`);
    else {
      v.forEach((x, j) => needNum(x, `${p}.recent_video_views[${j}]`, { min: 1 }));
      if (v.length < 5) E(`${p}.recent_video_views has ${v.length} values. Need at least 5, ideally 10 to 15.`);
      else if (v.length < 10 || v.length > 15) W(`${p}.recent_video_views has ${v.length} values. 10 to 15 is the target.`);
      if (v.every(isNum) && v.length >= 5) {
        const m = median(v);
        if (v.some(x => x > m * 8)) W(`${p}.recent_video_views has a value over 8× the median. Double-check it (a Short, a viral outlier or a typo?).`);
        if (isNum(c.subscribers) && m > c.subscribers) W(`${p}: median views exceed subscriber count. Check both numbers.`);
      }
    }
    if (c.uploads_per_month !== undefined) needNum(c.uploads_per_month, `${p}.uploads_per_month`, { min: 0 });
    ['recent_video_likes', 'recent_video_comments'].forEach(k => {
      if (c[k] === undefined) return;
      if (!Array.isArray(c[k])) return E(`${p}.${k} must be an array`);
      c[k].forEach((x, j) => needNum(x, `${p}.${k}[${j}]`, { min: 0 }));
      if (Array.isArray(v) && c[k].length !== v.length) E(`${p}.${k} has ${c[k].length} values but recent_video_views has ${v.length}. Same videos, same order.`);
    });
    if ((c.recent_video_likes === undefined) !== (c.recent_video_comments === undefined)) W(`${p}: give both recent_video_likes and recent_video_comments or neither (engagement needs both)`);
    if (Array.isArray(v) && Array.isArray(c.recent_video_likes) && Array.isArray(c.recent_video_comments) && v.length === c.recent_video_likes.length && v.length === c.recent_video_comments.length && v.every(isNum) && c.recent_video_likes.every(isNum) && c.recent_video_comments.every(isNum)) {
      const eng = (c.recent_video_likes.reduce((a, x) => a + x, 0) + c.recent_video_comments.reduce((a, x) => a + x, 0)) / v.reduce((a, x) => a + x, 0) * 100;
      if (eng > 25) W(`${p}: engagement works out to ${eng.toFixed(1)}%. Check the likes and comments columns.`);
    }
    if (c.media_kit_url && !httpsUrl(c.media_kit_url)) E(`${p}.media_kit_url must be an https URL`);
    else if (!c.media_kit_url) W(`${p}.media_kit_url missing. The media kit button will be hidden.`);
    if (c.best_integration && !ytVideoId(c.best_integration.video_url)) E(`${p}.best_integration.video_url is not a valid YouTube video link`);
    const fp = c.fit_points;
    if (!Array.isArray(fp) || !fp.length) E(`${p}.fit_points needs 2 to 4 short points`);
    else { if (fp.length < 2 || fp.length > 4) W(`${p}.fit_points has ${fp.length}. Aim for 2 to 4.`); fp.forEach((t, j) => { if (!str(t)) E(`${p}.fit_points[${j}] is empty`); else if (t.length > 160) W(`${p}.fit_points[${j}] is ${t.length} chars. Keep under 160.`); }); }
    const aud = c.audience || {};
    [['top_countries', 'name'], ['age_groups', 'label']].forEach(([k, nk]) => {
      if (aud[k] === undefined) return;
      if (!Array.isArray(aud[k])) return E(`${p}.audience.${k} must be an array`);
      aud[k].forEach((x, j) => { if (!str(x[nk])) E(`${p}.audience.${k}[${j}].${nk} is required`); needNum(x.pct, `${p}.audience.${k}[${j}].pct`, { min: 0 }); if (isNum(x.pct) && x.pct > 100) E(`${p}.audience.${k}[${j}].pct is over 100`); });
      const sum = aud[k].reduce((a, x) => a + (isNum(x.pct) ? x.pct : 0), 0);
      if (sum > 100.5) E(`${p}.audience.${k} adds up to ${sum}%. Must be 100 or less.`);
    });
    if (!aud.top_countries && !aud.age_groups) W(`${p}.audience missing. The audience block will be hidden.`);
  });
  if (isObj(b) && b.customer_value_usd === undefined) W('brand.customer_value_usd not set. Revenue rows stay hidden until the brand types a value into the calculator.');
}

/* ---------- report ---------- */
console.log(`\nChecking ${file}\n`);
errors.forEach(m => console.log('  ✗ ERROR  ', m));
warns.forEach(m => console.log('  ! warning', m));
if (!errors.length && !warns.length) console.log('  ✓ No problems found');
console.log(`\n${errors.length ? '✗' : '✓'} ${errors.length} error(s), ${warns.length} warning(s)\n`);
process.exit(errors.length ? 1 : 0);
