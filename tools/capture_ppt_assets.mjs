import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.CAPTURE_URL || 'https://anban-emergency-assistant.app.workbuddy.host/?sharecode=WH2RTIZXZI';
const OUT = 'docs/交付材料/素材';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function newPage(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  return { context, page };
}

async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log('saved', name);
}

async function hideComposer(page) {
  await page.addStyleTag({
    content: '.composer{display:none!important}.audit-toggle{display:none!important}.mode-band{display:none!important}',
  });
}

async function ask(page, text) {
  await page.fill('#dailyInput', text);
  await page.click('#dailyForm button[type="submit"]');
  await page.waitForTimeout(3000);
}

// 1) 桌面首屏
{
  const { context, page } = await newPage(1440, 900);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, '01-首屏-桌面');

  // 2) 日常科普卡（隐藏输入区，完整卡片）
  await ask(page, '怎么预防煤气泄漏');
  await hideComposer(page);
  const daily = page.locator('.msg-assistant').last();
  await daily.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await daily.screenshot({ path: `${OUT}/02-日常科普卡.png` });
  console.log('saved 02-日常科普卡(卡片)');
  await context.close();
}

// 3) 分诊卡 / 4) 步骤卡 / 5) 审计视图
{
  const { context, page } = await newPage(1440, 900);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await ask(page, '煤气漏了');
  await hideComposer(page);
  const triageCard = page.locator('.msg-assistant').last();
  await triageCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await triageCard.screenshot({ path: `${OUT}/03-紧急分诊卡.png` });
  console.log('saved 03-紧急分诊卡(卡片)');

  const triage = page.locator('.triage-btn').first();
  if (await triage.count()) {
    await triage.click();
    await page.waitForTimeout(900);
    const stepCard = page.locator('.msg-assistant').last();
    await stepCard.scrollIntoViewIfNeeded();
    await stepCard.screenshot({ path: `${OUT}/04-紧急步骤卡.png` });
    console.log('saved 04-紧急步骤卡(卡片)');
  }

  // 审计视图：重新加载后跑一遍，打开面板再截
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await ask(page, '煤气漏了');
  await page.locator('#auditToggle').click();
  await hideComposer(page);
  await page.waitForTimeout(500);
  await shot(page, '05-审计视图');
  const panel = page.locator('#auditPanel');
  if (await panel.count()) await panel.screenshot({ path: `${OUT}/05-审计视图-面板.png` });
  await context.close();
}

// 6) 手机首屏
{
  const { context, page } = await newPage(390, 844);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, '06-首屏-手机');
  await context.close();
}

await browser.close();
console.log('done');
