import { chromium } from 'playwright';

const url = process.env.TARGET || 'https://s.312522.xyz/';
const exe = '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox','--disable-setuid-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(2500);

async function bgInfo(sel){
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if(!el) return { sel:s, present:false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { sel:s, present:true, rect:[r.x|0,r.y|0,r.width|0,r.height|0], bg: cs.background, bgImage: cs.backgroundImage.slice(0,140), radius: cs.borderRadius, color: cs.color, padding: cs.padding };
  }, sel).catch(e=>({sel, err:String(e)}));
}

console.log('JSONSTART');
console.log(JSON.stringify({
  emojiIcon: await bgInfo('.emoji-icon'),
  navBtn: await bgInfo('.category-nav button'),
  sectionTitle: await bgInfo('.section-title'),
  sectionH2: await bgInfo('.category-section h2')
}));

// click 常用推荐 to activate
const n = page.locator('.category-nav button:has-text("常用推荐")').count().catch(()=>0);
console.log('recommendedButtons:', await n);
await page.locator('.category-nav button:has-text("常用推荐")').first().click({ timeout: 5000 }).catch(()=>{});
await page.waitForTimeout(800);
console.log('ACTIVE ' + JSON.stringify(await page.evaluate(() => {
  const el = document.querySelector('.category-nav button.active');
  if(!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { rect:[r.x|0,r.y|0,r.width|0,r.height|0], bg:cs.background, radius:cs.borderRadius, color:cs.color };
}).catch(e=>String(e))));
console.log('JSONEND');

await page.screenshot({ path: '/workspace/cf_shot.png' });
await browser.close();
console.log('saved cf_shot.png');