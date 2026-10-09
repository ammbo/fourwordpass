import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';

const base = path.resolve('output/devpost');
const gallery = path.join(base, 'gallery');
const manifest = JSON.parse(await fs.readFile(path.join(gallery, 'manifest.json'), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

for (const shot of manifest.screenshots) {
  const file = path.join(gallery, shot.file);
  const [meta, stat] = await Promise.all([sharp(file).metadata(), fs.stat(file)]);
  if (meta.format !== 'png' || meta.width * 2 !== meta.height * 3 || stat.size >= 5_000_000) throw new Error(`Not Devpost-ready: ${shot.file}`);
  shot.width = meta.width;
  shot.height = meta.height;
  shot.bytes = stat.size;
}
await fs.writeFile(path.join(gallery, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const cols = 3, tileWidth = 500, tileHeight = 386, gap = 18, margin = 30, top = 106;
const rows = Math.ceil(manifest.screenshots.length / cols);
const width = margin * 2 + cols * tileWidth + (cols - 1) * gap;
const height = top + rows * tileHeight + (rows - 1) * gap + margin;
const overlays = [{input:Buffer.from(`<svg width="${width}" height="106"><text x="30" y="46" font-family="Georgia,serif" font-size="32" fill="#17402f">Four Word Pass · Devpost gallery</text><text x="30" y="76" font-family="Arial,sans-serif" font-size="16" fill="#5d6f63">${manifest.screenshots.length} screenshots from the hosted sandbox · 3:2 PNGs · captured October 9, 2026</text></svg>`),left:0,top:0}];
for (let i = 0; i < manifest.screenshots.length; i++) {
  const shot = manifest.screenshots[i];
  const x = margin + i % cols * (tileWidth + gap);
  const y = top + Math.floor(i / cols) * (tileHeight + gap);
  overlays.push({input:await sharp(path.join(gallery, shot.file)).resize(tileWidth, 333).toBuffer(),left:x,top:y});
  overlays.push({input:Buffer.from(`<svg width="500" height="53"><rect width="500" height="53" fill="#fbf8f0"/><text x="12" y="24" font-family="Georgia,serif" font-size="19" fill="#17402f">${String(i+1).padStart(2,'0')} · ${escape(shot.title)}</text><text x="12" y="44" font-family="Arial,sans-serif" font-size="12" fill="#5d6f63">${shot.width} × ${shot.height} · ${(shot.bytes / 1_000_000).toFixed(2)} MB</text></svg>`),left:x,top:y+333});
}
await sharp({create:{width,height,channels:3,background:'#f4efe2'}}).composite(overlays).jpeg({quality:88,mozjpeg:true}).toFile(path.join(base,'gallery-preview.jpg'));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Four Word Pass · Devpost gallery</title><style>body{margin:0;background:#f4efe2;color:#17402f;font:16px/1.6 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:40px 24px}h1,h2{font-family:Georgia,serif}h1{font-size:42px;line-height:1.1;margin:0 0 16px}header p{max-width:780px}a{color:inherit}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:28px;margin-top:32px}figure{margin:0;border:1px solid #cfc6ad;border-radius:14px;overflow:hidden;background:#fbf8f0}img{display:block;width:100%;aspect-ratio:3/2}figcaption{padding:20px}h2{font-size:25px;line-height:1.2;margin:0 0 12px}.meta,.notes{font-size:13px;color:#5d6f63}.notes{border-top:1px solid #cfc6ad;padding-top:12px}p{margin:10px 0}</style></head><body><main><header><h1>Four Word Pass</h1><p>${manifest.screenshots.length} Devpost gallery images captured from the hosted PayPal sandbox on October 9, 2026. Every PNG uses a 3:2 ratio and is smaller than 5 MB. Click an image to open the original.</p><p><a href="devpost-gallery.zip">Download all PNGs</a> · <a href="gallery/README.md">Captions and capture notes</a></p><p class="meta">Screenshots preserve the actual app state, including demo history, test payments and pending stamp art. The ledger image is a screenshot card with its caption outside the original capture. Example form values were typed but never submitted.</p></header><div class="grid">${manifest.screenshots.map((s,i)=>`<figure><a href="gallery/${escape(s.file)}"><img src="gallery/${escape(s.file)}" alt="${escape(s.title)}" loading="lazy"></a><figcaption><h2>${String(i+1).padStart(2,'0')} · ${escape(s.title)}</h2><p>${escape(s.caption)}</p><p class="meta">${s.width} × ${s.height} PNG · ${(s.bytes/1_000_000).toFixed(2)} MB · <a href="${escape(s.source)}">Live source</a></p>${s.notes?`<p class="notes">${escape(s.notes)}</p>`:''}</figcaption></figure>`).join('')}</div></main></body></html>`;
await fs.writeFile(path.join(base,'gallery-preview.html'), html);

const readme = `# Four Word Pass — Devpost images\n\n${manifest.screenshots.length} PNG screenshots from https://fourwordpass.com, captured October 9, 2026.\n\n- Every image: 1935 × 1290 pixels, exactly 3:2.\n- Every file is under Devpost's 5 MB limit.\n- Numbered filenames give the suggested upload order.\n- Upload the PNGs; the preview JPG, HTML, scripts, notes and manifest are not gallery images.\n- No page content or API responses were substituted. Map tiles, fonts, PayPal frames, AG Grid and AG Charts were rendered in Chrome.\n- No orders, payments, claims, forks, subscriptions or emails were submitted while capturing. Form values use example.com.\n\n## Paste-ready captions\n\n${manifest.screenshots.map((s,i)=>`${i+1}. **${s.title}** — [${s.file}](${s.file})\n\n   ${s.caption}\n`).join('\n')}\n## Capture notes\n\n${manifest.screenshots.filter(s=>s.notes).map(s=>`- **${s.file}:** ${s.notes}`).join('\n')}\n\n## Optional shots that still need private access or more product activity\n\n- **Holder-only AI suggestions:** requires a current private holder link. The public release form was used for the live four-word counter instead.\n- **Nag email:** requires an actual received email or access to an operator-approved demo outbox. No reminder was sent for these screenshots.\n- **Populated authorship and AI model charts:** Open Books currently has no non-demo story/AI records for those charts. Their real empty state has been left intact.\n- **Fork family tree:** neither featured demo bill currently has a branch. Image 11 shows the real fork dialog without creating a branch.\n\nJavaScript, maps, chart canvases, stamps and the PayPal button were capturable; no manual screenshot is required for the included images.\n\n## Re-capture\n\nFrom the repository root, run \`node output/devpost/capture-gallery.mjs\`, then \`node output/devpost/package-gallery.mjs\`. The capture script uses the bundled Playwright runtime and installed Google Chrome. \`FWP_GALLERY_START=4\` resumes from the public form and keeps already captured images. Screenshot paths, source URLs and capture timestamps are saved in \`manifest.json\`.\n`;
await fs.writeFile(path.join(gallery,'README.md'), readme);
const zip = path.join(base, 'devpost-gallery.zip');
await fs.rm(zip, {force:true});
const archived = spawnSync('zip', ['-q', '-j', zip, ...manifest.screenshots.map(s => path.join(gallery,s.file))], {encoding:'utf8'});
if (archived.status !== 0) throw new Error(archived.stderr || 'Could not create gallery ZIP');
console.log(JSON.stringify({count:manifest.screenshots.length,largestMB:Math.max(...manifest.screenshots.map(s=>s.bytes))/1_000_000,dimensions:[...new Set(manifest.screenshots.map(s=>`${s.width}x${s.height}`))],browserErrors:manifest.browserErrors},null,2));
