import { test, expect, type Page } from '@playwright/test';
async function account(page: Page, signedIn = false, unavailable = false) {
  await page.route('**/api/config', route => route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session', route => route.fulfill({status:unavailable ? 503 : signedIn ? 200 : 401,json:signedIn ? {user:{name:'Test Member',email:'member@example.com'},access:{active:false},billingReady:true} : {user:null}}));
}
test('anonymous visitors see prices and email sign-in without loading study content', async ({page}) => {
  await account(page);
  const dataRequests: string[]=[];
  page.on('request', r=> { if(/\/(packs|content)\//.test(r.url())) dataRequests.push(r.url()); });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Choose monthly'})).toBeEnabled();
  const plans = page.locator('.membership-plan');
  await expect(plans.first()).toContainText('Yearly');
  await expect(plans.first()).toContainText('$12.50/ month');
  await expect(plans.first()).toContainText('$150 billed yearly');
  await expect(plans.first()).toContainText('Save $90');
  await expect(plans.nth(1)).toContainText('Monthly');
  await expect(plans.nth(1)).toContainText('$20 billed every 30 days');
  expect(dataRequests).toEqual([]);
  await page.getByRole('button',{name:'Start yearly'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Yearly · $12.50/month equivalent · $150 billed yearly');
  await expect(page.getByRole('button',{name:'Continue with email'})).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('sign-in window returns to the selected plan without leaving the site', async ({page, context}) => {
  let signedIn = false;
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({status:signedIn?200:401,json:signedIn?{user:{name:'Member',email:'member@example.com'},access:{active:false},billingReady:true}:{user:null}}));
  await context.route('**/api/auth/email',route=> { signedIn=true; return route.fulfill({contentType:'text/html',body:`<script>opener.postMessage({type:'rvm-auth',ok:true},location.origin);window.close();</script>`}); });
  let tier: unknown;
  await page.route('**/api/billing/checkout',route=>{tier=route.request().postDataJSON();return route.fulfill({json:{id:'ch_test',returnUrl:'http://localhost:4317/?checkout=returned'}});});
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/');
  await page.getByRole('button',{name:'Start yearly'}).click();
  await page.getByRole('button',{name:'Continue with email'}).click();
  await expect(page.getByRole('heading',{name:'Your study space is almost ready.'})).toBeVisible();
  expect(tier).toEqual({tier:'yearly'});
  expect(new URL(page.url()).origin).toBe('http://localhost:4317');
  await expect(page.locator('.auth-dialog')).not.toBeVisible();
  await expect(page.getByText('Standard price: $150 USD every 365 days.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Change plan'}).click();
  await expect(page.getByRole('button',{name:'Choose monthly'})).toBeEnabled();
});
test('verified admin enters the app without a purchase', async ({page}) => {
  await account(page,true);
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Kerim',email:'kerim.sabic@gmail.com'},access:{active:true,role:'admin'},billingReady:true}}));
  await page.goto('/');
  await expect(page.getByText('Admin · free access',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Choose monthly'})).not.toBeVisible();
});
test('signed-in customer selects only the approved monthly tier', async ({page}) => {
  await account(page,true);
  let submitted: unknown;
  await page.route('**/api/billing/checkout', async route => { submitted=route.request().postDataJSON(); await route.fulfill({status:503,json:{error:'Checkout is temporarily unavailable.'}}); });
  await page.goto('/?plans');
  await page.getByRole('button',{name:'Choose monthly'}).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  expect(submitted).toEqual({tier:'monthly'});
  await expect(page.getByRole('button',{name:'Choose monthly'})).toBeEnabled();
});
test('return URL cannot grant access without confirmed payment', async ({page}) => {
  await account(page,true);
  await page.route('**/api/billing/refresh',route=>route.fulfill({json:{access:{active:false}}}));
  await page.goto('/?checkout=returned');
  await expect(page.getByRole('alert')).toContainText('payment hasn’t been confirmed');
  await expect(page.getByRole('button',{name:'Start yearly'})).toBeVisible();
});
test('service failure keeps study content locked and offers retry', async ({page}) => {
  await account(page,false,true);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('couldn’t verify your access');
  await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
});
test('membership is usable on a narrow phone screen', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await account(page,true);
  await page.goto('/?plans');
  await expect(page.getByRole('button',{name:'Start yearly'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const annual = page.locator('.membership-plan.yearly');
  const monthly = page.locator('.membership-plan.monthly');
  expect((await annual.boundingBox())!.y).toBeLessThan((await monthly.boundingBox())!.y);
  await expect(annual.getByText('$150 billed yearly')).toBeVisible();
  await page.locator('#plans').screenshot({path:'test-results/membership-mobile.png'});
});

test('a promo code survives signup and reaches the on-page monthly checkout', async ({page, context}) => {
  let signedIn = false;
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({status:signedIn?200:401,json:signedIn?{user:{name:'Member',email:'member@example.com'},access:{active:false},billingReady:true}:{user:null}}));
  await context.route('**/api/auth/email',route=> { signedIn=true; return route.fulfill({contentType:'text/html',body:`<script>opener.postMessage({type:'rvm-auth',ok:true},location.origin);window.close();</script>`}); });
  let submitted: unknown;
  await page.route('**/api/billing/checkout',route=>{submitted=route.request().postDataJSON();return route.fulfill({json:{id:'ch_promo',promoCode:'nadin',returnUrl:'http://localhost:4317/?checkout=returned'}});});
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/?a=study-pal');
  await page.goto('/'); // A return visit must preserve credit before the friend signs up.
  await page.getByText('Have a promo code?',{exact:true}).click();
  await page.getByLabel('Promo code',{exact:true}).fill('NADIN');
  await page.getByRole('button',{name:'Choose monthly'}).click();
  await page.getByRole('button',{name:'Continue with email'}).click();
  await expect(page.getByRole('heading',{name:'Your study space is almost ready.'})).toBeVisible();
  expect(submitted).toEqual({tier:'monthly',promoCode:'NADIN',affiliateCode:'study-pal'});
  await expect(page.getByText('Your code is prefilled',{exact:false})).toBeVisible();
});

test('a code added after choosing monthly switches offers before payment and can be removed', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Member',email:'member@example.com'},access:{active:false},billingReady:true}}));
  const submitted: {tier:string;promoCode?:string}[]=[];
  await page.route('**/api/billing/checkout',route=>{
    const body=route.request().postDataJSON(); submitted.push(body);
    return route.fulfill({json:{id:body.promoCode?'ch_promo':'ch_standard',...(body.promoCode?{promoCode:'nadin'}:{}),returnUrl:'http://localhost:4317/?checkout=returned'}});
  });
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/?plans');
  await page.getByRole('button',{name:'Choose monthly'}).click();
  await page.getByLabel('Promo code',{exact:true}).fill(' NADIN ');
  await expect(page.getByRole('status').filter({hasText:'Apply your code to update the price before paying.'})).toBeVisible();
  await page.getByRole('button',{name:'Apply code',exact:true}).click();
  await expect(page.getByText('Your code is prefilled',{exact:false})).toBeVisible();
  expect(submitted.at(-1)).toEqual({tier:'monthly',promoCode:'NADIN'});
  await expect(page.getByRole('button',{name:'Apply code',exact:true})).toBeDisabled();
  await page.getByLabel('Promo code',{exact:true}).fill('');
  await page.getByRole('button',{name:'Remove code',exact:true}).click();
  await expect(page.getByText('Standard price: $20 USD every 30 days.',{exact:false})).toBeVisible();
  expect(submitted.at(-1)).toEqual({tier:'monthly'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('members can copy their verified referral link in an accessible phone dialog', async ({page, context, browserName}) => {
  await page.setViewportSize({width:390,height:844});
  // Only Chromium lets a test read the clipboard back.
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read','clipboard-write']);
  await account(page,true);
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Member',email:'member@example.com'},access:{active:true,tier:'monthly'},billingReady:true}}));
  const link='https://whop.com/e/trk_zpdZ5h59TRkTrN/study-pal';
  await page.route('**/api/referrals',route=>route.fulfill({json:{shareUrl:link}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Invite friends',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Share the practice. Earn 20% cash.'});
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Your referral link')).toHaveValue(link);
  await page.getByRole('button',{name:'Copy link',exact:true}).click();
  await expect(page.getByRole('button',{name:'Copied!'})).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(link);
  await expect(dialog).toContainText('30-day waiting period');
  await expect(dialog.getByRole('link',{name:'Referral activity'})).toHaveAttribute('href','https://whop.com/radiology-monster/affiliates/');
  expect(await dialog.evaluate(el=>el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.screenshot({path:'test-results/referrals-mobile.png'});
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Invite friends',exact:true})).toBeFocused();
});

test('referral lookup failure offers the real Whop portal and can recover', async ({page}) => {
  await account(page,true);
  let failing=true;
  await page.route('**/api/referrals',route=>route.fulfill({status:failing?503:200,json:failing?{error:'Unavailable'}:{shareUrl:null}}));
  await page.goto('/?plans'); // a free account finds the invite on the plans screen
  await page.getByRole('button',{name:'Invite friends',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('couldn’t load your link');
  await expect(page.getByRole('link',{name:'Get my link on Whop'})).toHaveAttribute('href','https://whop.com/radiology-monster/affiliates/');
  failing=false;
  await page.getByRole('button',{name:'Check my linked account again'}).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Get your personal link'})).toBeVisible();
});
test('landing page: modality tour, answers, screenshots and credits, all before access', async ({page}) => {
  await account(page);
  const dataRequests: string[]=[];
  page.on('request', r=> { if(/\/(packs|content)\//.test(r.url())) dataRequests.push(r.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Learn to read scans on real patients.');
  await expect.poll(()=>page.locator('.lp-hero-shot img').evaluate((i: HTMLImageElement)=>i.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('tab',{name:'Mammography'}).click();
  await expect(page.getByRole('tabpanel')).toContainText('Hung like a real mammography reading');
  await page.getByRole('tab',{name:'Mammography'}).press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Ultrasound'})).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Cyst or solid?');
  await page.getByText('Can I use it to diagnose patients?').click();
  await expect(page.getByText('It is not a medical device')).toBeVisible();
  await expect(page.locator('.lp-credits').last()).toContainText('CBIS-DDSM');
  // The anatomy outlines are labelled AI, and Horalix.com is thanked, with a link.
  await expect(page.locator('.lp-credits', {hasText: 'Anatomy outlines: AI.'}).getByRole('link',{name:'Thanks to Horalix.com'})).toHaveAttribute('href','https://horalix.com');
  await page.getByText('Who marked the findings and the anatomy?').click();
  await expect(page.getByText('labelled AI wherever it appears')).toBeVisible();
  await page.getByRole('link',{name:'See plans',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Choose monthly'})).toBeInViewport();
  await expect(page.locator('.lp-free')).toContainText('$0');
  await expect(page.locator('.lp-affiliation')).toContainText('not affiliated');
  await page.getByRole('button',{name:'Start free'}).first().click();
  await expect(page.locator('.auth-dialog')).toBeVisible();
  await expect(page.getByRole('tab',{name:'Create account'})).toHaveAttribute('aria-selected','true');
  expect(dataRequests).toEqual([]);
});

test('free account: the sample patients open; the case of the week and everything else show what membership adds', async ({page}) => {
  await account(page,true);
  await page.goto('/');
  await expect(page.locator('.free-banner')).toContainText('Free account');
  await expect(page.locator('.cow.locked')).toContainText('Case of the week · members');
  await expect(page.locator('.cow.locked')).toContainText('Patient');
  // Members-only areas explain themselves and lead to the plans.
  await page.goto('/drill');
  await expect(page.getByRole('heading',{name:'Drills that remember'})).toBeVisible();
  await page.getByRole('button',{name:'See plans'}).last().click();
  await expect(page.getByRole('heading',{name:'Unlock the whole library.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start yearly'})).toBeEnabled();
  await page.getByRole('button',{name:'Back to the app'}).click();
  await expect(page.locator('.plans-screen')).toHaveCount(0);
  // The library: the free patients open, the rest listed by neutral title and locked.
  await page.goto('/cases');
  await expect(page.locator('.case-card').first()).toBeVisible();
  expect(await page.locator('.case-card').count()).toBe(2);
  await expect(page.locator('.locked-tile').first()).toContainText('Case of the week');
  await expect(page.locator('.locked-library h2')).toContainText('more patients for members');
  await expect(page.locator('.locked-tile').first()).toBeVisible();
  // A members' patient from a link: what it is, not an error and not the images.
  const dicom: string[] = [];
  page.on('request', r => { if (/\/packs\/pe-cta\/dicom\/.*pat021|\/packs\/[\w-]+\/pack\.json$/.test(r.url())) dicom.push(r.url()); });
  await page.goto('/read/pe-pat021?mode=practice');
  await expect(page.locator('.locked-card')).toContainText('Patient');
  await expect(page.getByRole('button',{name:'See plans'})).toBeVisible();
  expect(dicom).toEqual([]);
});

test('a book-only account reads the book without a plan; the rest stays the free edition', async ({page}) => {
  await page.route('**/api/config', route => route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session', route => route.fulfill({json:{user:{name:'Reader',email:'reader@example.com'},access:{active:false},billingReady:true,book:true}}));
  await page.route('**/api/book', route => route.fulfill({status:404,body:''}));
  await page.goto('/book');
  await expect(page.locator('.free-banner')).toContainText('Free account');
  await expect(page.getByRole('heading',{name:'The book, page by page'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Book'}).locator('.nav-lock')).toHaveCount(0);
  await page.goto('/drill');
  await expect(page.getByRole('heading',{name:'Drills that remember'})).toBeVisible();
});

test('a certificate has a public page that needs no sign-in', async ({page}) => {
  await page.route('**/api/session', route => route.fulfill({status:401,json:{user:null}}));
  await page.route('**/api/certificate?id=*', route => route.fulfill({json:{certificate:{id:'abcDEF123_-x',name:'Ada Lovelace',area:'chest',title:'Chest imaging',patients:14,judged:22,accuracy:0.82,issuedAt:'2026-10-29T10:00:00.000Z'}}}));
  await page.goto('/certificate/abcDEF123_-x');
  await expect(page.locator('.cert-name')).toHaveText('Ada Lovelace');
  await expect(page.locator('.cert-title')).toHaveText('Chest imaging');
  await expect(page.locator('.cert-stats')).toContainText('14');
  await expect(page.locator('.cert-stats')).toContainText('Real patients');
  await expect(page.locator('.cert-stats')).toContainText('82%');
  // LinkedIn opens its certification form empty, so the page lists each field to copy into it.
  await expect(page.locator('#add-to-linkedin')).toHaveCount(0);
  await page.getByRole('button',{name:'Add to LinkedIn profile'}).click();
  const li = page.locator('#add-to-linkedin');
  await expect(li.getByRole('link',{name:/Open LinkedIn.s certification form/})).toHaveAttribute('href',/linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME/);
  await expect(li.locator('.cert-li-fields')).toContainText('Certificate – Level 1 (Foundation)');
  await expect(li.locator('.cert-li-fields')).toContainText('radiology.monster');
  await expect(li.locator('.cert-li-fields')).toContainText('October 2026');
  await expect(li.locator('.cert-li-fields')).toContainText('abcDEF123_-x');
  await expect(li.locator('.cert-li-fields')).toContainText('/verify/abcDEF123_-x');
  await expect(li.getByRole('button',{name:'Copy Credential URL'})).toBeVisible();
  // Arriving from Claim opens it straight away.
  await page.goto('about:blank');
  await page.goto('/certificate/abcDEF123_-x#add-to-linkedin');
  await expect(page.locator('#add-to-linkedin')).toBeVisible();
  await expect(page.getByRole('link',{name:'Post on LinkedIn'})).toHaveAttribute('href',/linkedin\.com\/sharing\/share-offsite\/\?url=.*verify%2FabcDEF123_-x/);
  await expect(page.getByRole('link',{name:'Image for a post'})).toHaveAttribute('href','/api/og/certificate?id=abcDEF123_-x');
  await expect(page.getByRole('textbox',{name:'Post text'})).toHaveValue(/#radiology/);
  await expect(page.getByRole('link',{name:'Start free'})).toHaveAttribute('href','/');
  await expect(page.getByRole('button',{name:'Choose monthly'})).toHaveCount(0);
});
