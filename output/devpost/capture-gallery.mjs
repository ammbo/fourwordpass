import { chromium } from '/Users/ammonbrown/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Capture the deployed app, including real fonts, maps, SDK frames and charts.
// No page content, network responses or product data are substituted.
const out = path.resolve('output/devpost/gallery');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1290, height: 860 },
  deviceScaleFactor: 1.5,
  locale: 'en-US',
  timezoneId: 'America/New_York',
});
const page = await context.newPage();
const start = Number(process.env.FWP_GALLERY_START ?? 0);
const only = process.env.FWP_GALLERY_ONLY?.split(',').map(Number);
const wanted = number => !only || only.includes(number);
const manifest = start || only ? JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8')).screenshots : [];
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

async function open(route, ready) {
  await page.goto(`https://fourwordpass.com${route}`, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);
}

async function scrollTo(locator, margin = 95) {
  await locator.evaluate((el, gap) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - gap, behavior: 'instant' }), margin);
  await page.waitForTimeout(450);
}

async function capture(file, title, caption, notes = '') {
  if (!wanted(Number(file.slice(0, 2)))) return;
  await page.mouse.move(2, 2);
  await page.waitForTimeout(600);
  if (file === '09-paypal-ledger.png') {
    // A screenshot card: the ledger pixels are untouched; the caption sits outside it.
    // Use AG Grid's normal drag-out interaction to hide the date and empty hop
    // columns, leaving room for the full payment-verification columns.
    for (const id of ['at', 'hop']) {
      const header = page.locator(`.ag-header-cell[col-id="${id}"]`);
      const box = await header.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(15, box.y + box.height / 2, {steps:20});
        await page.waitForTimeout(350);
        await page.mouse.up();
        await page.waitForTimeout(350);
      }
    }
    await page.locator('.ag-body-horizontal-scroll-viewport').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    const resize = await page.locator('.ag-header-cell[col-id="webhook"] .ag-header-cell-resize').boundingBox();
    if (resize) {
      await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
      await page.mouse.down();
      await page.mouse.move(resize.x + resize.width / 2 + 45, resize.y + resize.height / 2, {steps:8});
      await page.mouse.up();
    }
    await page.mouse.move(2,2);
    await page.waitForTimeout(300);
    const fragment = await page.getByRole('heading', { name: 'The ledger', exact: true }).locator('xpath=ancestor::section').screenshot({animations:'disabled'});
    const meta = await sharp(fragment).metadata();
    const x = Math.round((1935 - meta.width) / 2);
    const markup = `<svg width="1935" height="1290"><rect width="1935" height="1290" fill="#f4efe2"/><text x="128" y="130" font-family="Georgia,serif" font-size="34" fill="#17402f">Four Word Pass</text><text x="128" y="215" font-family="Arial,sans-serif" font-size="21" letter-spacing="4" fill="#5d6f63">OPEN BOOKS · PAYPAL SANDBOX</text><text x="128" y="300" font-family="Georgia,serif" font-size="66" fill="#17402f">Every handoff leaves a receipt.</text><text x="128" y="353" font-family="Arial,sans-serif" font-size="28" fill="#5d6f63">PayPal statuses, masked references and signed webhooks.</text><path d="M128 1010H1807" stroke="#cfc6ad"/><text x="128" y="1075" font-family="Georgia,serif" font-size="32" fill="#17402f">Status from PayPal</text><text x="740" y="1075" font-family="Georgia,serif" font-size="32" fill="#17402f">Emails stay private</text><text x="1350" y="1075" font-family="Georgia,serif" font-size="32" fill="#17402f">Export to CSV</text><text x="128" y="1203" font-family="Arial,sans-serif" font-size="22" fill="#5d6f63">Live ledger capture · fourwordpass.com/books · October 9, 2026</text><text x="128" y="1243" font-family="Arial,sans-serif" font-size="20" fill="#b3261e">Sandbox beta. Test money only; no real funds move.</text></svg>`;
    await sharp(Buffer.from(markup)).composite([{input:fragment,left:x,top:440}]).png().toFile(path.join(out,file));
  } else {
    await page.screenshot({ path: path.join(out, file), animations: 'disabled' });
  }
  const previous = manifest.findIndex(entry => entry.file === file);
  if (previous >= 0) manifest.splice(previous, 1);
  manifest.push({ file, title, caption, notes, source: page.url(), capturedAt: new Date().toISOString(), scrollY: await page.evaluate(() => window.scrollY), width: 1935, height: 1290 });
  console.log(file);
}

try {
  if (start <= 1 && wanted(1)) {
  await open('/', () => page.getByRole('link', { name: 'Read the story this buck carries →' }).waitFor());
  await capture('01-passage-of-the-buck.png', 'Passage of the Buck', 'A dollar carries a story from person to person, four words at a time. The hosted prototype uses PayPal sandbox test money.');
  }

  if (start <= 3 && [2,3,5].some(wanted)) {
  await open('/b/FWP-0002', () => page.getByRole('heading', { name: 'Wendell the Damp', exact: true }).waitFor());
  await page.locator('.fwp-pin').first().waitFor();
  await page.waitForTimeout(2000);
  await capture('02-meet-wendell.png', 'Meet Wendell the Damp', 'Every bill gets a name, a voice and a journey. Wendell is a labeled demo bill with simulated early history.');
  await scrollTo(page.getByRole('heading', { name: 'The Story', exact: true }));
  await capture('03-story-and-passage.png', 'The Story and The Passage', 'Read the story beside its city-by-city route, then inspect a hop and its masked PayPal receipt.', 'FWP-0002 has labeled demo history; its latest displayed receipt is a PayPal sandbox payout.');
  await scrollTo(page.getByRole('heading', { name: 'The Diary', exact: true }));
  await capture('05-diary-and-passport.png', 'The Diary and The Passport', 'The bill narrates its travels in an AI-written diary and collects illustrated city stamps.', 'Wendell is a demo bill. The newest stamp is visibly still inking; completed historical stamps are shown as rendered.');
  }

  if (start <= 4 && [4,7].some(wanted)) {
  await open('/release', () => page.getByPlaceholder('once a lonely robot', { exact: true }).waitFor());
  await page.getByPlaceholder('once a lonely robot', { exact: true }).fill('and then the lights dimmed');
  await page.getByText("That's 2 content words. The buck demands four.", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await capture('04-four-words-that-count.png', 'Four words that count', 'The live word counter counts “lights” and “dimmed”; connecting words ride free.');
  await page.getByPlaceholder('once a lonely robot', { exact: true }).fill('the robot learned to dream tonight');
  await page.getByRole('button', { name: 'Release to the wild', exact: true }).click();
  await page.getByPlaceholder('a robot learning to dream', { exact: true }).fill('a robot learning to dream');
  // These are unsent example form values, not a minted bill or payment.
  await page.getByPlaceholder('you@example.com', { exact: true }).fill('storyteller@example.com');
  await page.getByPlaceholder('Pen name (optional)', { exact: true }).fill('A stranger');
  await page.getByText("Pay with PayPal's sandbox test card", { exact: true }).waitFor();
  console.log('release frames', page.frames().map(f => f.url().split('?')[0]));
  console.log('release buttons', await page.getByRole('button').allTextContents());
  const checkoutText = page.getByText("Pay with PayPal's sandbox test card", { exact: true });
  if (await checkoutText.count()) {
    await scrollTo(checkoutText, 330);
  } else {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight - innerHeight, behavior: 'instant' }));
  }
  await capture('07-sandbox-checkout.png', 'Sandbox checkout', 'Starting a story costs $2 in PayPal sandbox test money. The page provides a published test card and PayPal’s checkout button.', 'Unsubmitted form with example.com sample values. No order was created, no payment was submitted and no email was sent.');
  }

  if (start <= 6 && wanted(6)) {
  await open('/wild', () => page.getByRole('heading', { name: 'Bucks nobody named.', exact: true }).waitFor());
  await page.getByRole('button', { name: 'Read it and claim it', exact: true }).first().waitFor();
  await capture('06-join-from-the-wild.png', 'Join from the wild', 'A bill released to the wild waits for a stranger to claim it and add the next four words.', 'Only the public list is opened; no bill is claimed.');
  }

  if (start <= 8 && [8,9].some(wanted)) {
  await open('/books', () => page.getByRole('heading', { name: 'Every dollar, in and out.', exact: true }).waitFor());
  await page.locator('.ag-row').first().waitFor();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo({ top: 60, behavior: 'instant' }));
  await capture('08-open-books.png', 'Open Books', 'A public ledger shows the observed PayPal sandbox totals and payments over time. Demo payments are excluded.', 'At capture: $0 paid in, $3 paid out, 3 sandbox payouts. These are current test counts, not adoption or real-money metrics.');
  await scrollTo(page.getByRole('heading', { name: 'The ledger', exact: true }));
  await capture('09-paypal-ledger.png', 'The PayPal ledger', 'The ledger exposes PayPal status, masked references, landing times and webhook confirmation without publishing email addresses.', 'Gallery card with an unaltered screenshot of the live ledger and a caption outside it. The date and empty hop columns were hidden with AG Grid’s normal drag-out interaction to show payment verification. Three observed sandbox payouts.');
  }

  if (start <= 10 && wanted(10)) {
  await open('/b/FWP-0001', () => page.getByRole('heading', { name: 'Valentine the Crumpled', exact: true }).waitFor());
  await page.locator('.fwp-pin').first().waitFor();
  await scrollTo(page.getByText('In memoriam · FWP-0001', { exact: true }).locator('..'), 95);
  await capture('10-a-bills-own-eulogy.png', 'A bill’s own eulogy', 'A bill that has stopped traveling writes a eulogy in its own voice. Valentine’s journey is labeled demo history.');
  }

  if (start <= 11 && wanted(11)) {
  await open('/b/FWP-0002', () => page.getByRole('heading', { name: 'Wendell the Damp', exact: true }).waitFor());
  await page.locator('.fwp-pin').first().waitFor();
  await scrollTo(page.getByRole('heading', { name: 'The Story', exact: true }));
  await page.getByRole('button', { name: /Fork from here/ }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByPlaceholder('but the robot refused', { exact: true }).fill('but the lighthouse remembered distant sailors');
  await capture('11-fork-the-story.png', 'Fork the story', 'Start a new branch from a chosen hop and carry the story in another direction.', 'Fork dialog only. No checkout, branch, payout or email is created.');
  }
} finally {
  manifest.sort((a, b) => a.file.localeCompare(b.file));
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify({capturedFrom:'https://fourwordpass.com', viewport:{width:1290,height:860,deviceScaleFactor:1.5}, screenshots:manifest, browserErrors:errors}, null, 2) + '\n');
  await browser.close();
}
