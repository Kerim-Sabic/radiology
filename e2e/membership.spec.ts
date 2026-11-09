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
  await page.getByRole('button',{name:'Account',exact:true}).click();
  await expect(page.getByRole('menu').getByText('Admin · free access',{exact:true})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Admin'})).toBeVisible();
  await page.keyboard.press('Escape');
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
  expect(submitted).toEqual({tier:'monthly',promoCode:'nadin',affiliateCode:'study-pal'});
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
  expect(submitted.at(-1)).toEqual({tier:'monthly',promoCode:'nadin'});
  await expect(page.getByRole('button',{name:'Apply code',exact:true})).toBeDisabled();
  await page.getByLabel('Promo code',{exact:true}).fill('');
  await page.getByRole('button',{name:'Remove code',exact:true}).click();
  await expect(page.getByText('Standard price: $20 USD every 30 days.',{exact:false})).toBeVisible();
  expect(submitted.at(-1)).toEqual({tier:'monthly'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a visitor with a regional price keeps it with the welcome code, which takes 40% off it', async ({page}) => {
  const code='welcome-ana-k7q3m';
  const bosnia={country:'BA',countryName:'Bosnia and Herzegovina'};
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Ana',email:'ana@example.com'},access:{active:false},billingReady:true,
    welcomeOffer:{code,expiresAt:new Date(Date.now()+48*3600_000).toISOString(),percent:40},
    regionalPrice:{region:'b',...bosnia,monthly:{price:9.99,pass:false},yearly:{price:74.99,pass:false}}}}));
  let submitted:{tier:string;promoCode?:string}|undefined;
  await page.route('**/api/billing/checkout',route=>{submitted=route.request().postDataJSON();return route.fulfill({json:{id:'ch_ba',promoCode:code,welcome:true,studentDiscount:false,returnUrl:'http://localhost:4317/?checkout=returned',regional:{...bosnia,price:9.99,days:30,pass:false}}});});
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/?plans');
  await expect(page.locator('.regional-price')).toContainText('Your welcome code works on these prices');
  await expect(page.locator('.welcome-offer')).toContainText('Monthly $5.99 for your first month instead of $9.99');
  await expect(page.locator('#membership-promo')).toHaveValue(code);
  const plans=page.locator('.membership-plan');
  await expect(plans.nth(1)).toContainText('$9.99 billed every 30 days');
  await page.locator('#plans').screenshot({path:'test-results/regional-welcome-plans.png'});
  await page.getByRole('button',{name:'Choose monthly'}).click();
  expect(submitted).toEqual({tier:'monthly',promoCode:code});
  await expect(page.locator('.welcome-applied')).toContainText('($5.99 instead of $9.99)');
  await expect(page.locator('.welcome-applied')).toContainText('Renewals are $9.99 USD every 30 days.');
  await expect(page.locator('.regional-applied')).toContainText('Your welcome code works on this price');
  await page.locator('#plans').screenshot({path:'test-results/regional-welcome-checkout.png'});
});

test('an Indian visitor can pay the pass by UPI in rupees, and switch back to a card', async ({page}) => {
  const india={country:'IN',countryName:'India'};
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Ravi',email:'ravi@example.com'},access:{active:false},billingReady:true,
    regionalPrice:{region:'c',...india,monthly:{price:4.99,pass:true},yearly:{price:39.99,pass:true},upi:{monthly:469,yearly:3749}}}}));
  const bodies:Array<Record<string,unknown>>=[];
  await page.route('**/api/billing/checkout',route=>{const b=route.request().postDataJSON();bodies.push(b);const upi=b.method==='upi';
    return route.fulfill({json:{id:upi?'ch_upi':'ch_card',returnUrl:'http://localhost:4317/?checkout=returned',regional:{...india,price:39.99,days:365,pass:true,...(upi?{rupees:3749,method:'upi'}:{})}}});});
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/?plans');
  await expect(page.locator('.regional-price')).toContainText('₹469 for 30 days · ₹3,749 for a year');
  await page.getByRole('button',{name:'or pay $39.99 by card'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Pay by UPI instead: ₹3,749');
  await page.locator('.upi-switch').getByRole('button',{name:'Pay by UPI'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Paying ₹3,749 by UPI');
  expect(bodies).toEqual([{tier:'yearly'},{tier:'yearly',method:'upi'}]);
  await page.locator('.upi-switch').getByRole('button',{name:'Pay by card instead'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Pay by UPI instead');
  expect(bodies.at(-1)).toEqual({tier:'yearly'});
});

test('an Indian visitor with a welcome code pays its 40% off by UPI, or, where the code is card only, can pay by UPI without it', async ({page}) => {
  const code='welcome-ravi-k7q3m';
  const india={country:'IN',countryName:'India'};
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Ravi',email:'ravi@example.com'},access:{active:false},billingReady:true,
    welcomeOffer:{code,expiresAt:new Date(Date.now()+48*3600_000).toISOString(),percent:40},
    regionalPrice:{region:'c',...india,monthly:{price:4.99,pass:true},yearly:{price:39.99,pass:true},upi:{monthly:469,yearly:3749}}}}));
  // First the code is on the UPI pass; then (a code made before the UPI passes) it is not, and the server keeps the card form.
  let codeOnUpi=true;
  const bodies:Array<Record<string,unknown>>=[];
  await page.route('**/api/billing/checkout',route=>{const b=route.request().postDataJSON();bodies.push(b);
    const upi=b.method==='upi'&&(codeOnUpi||!b.promoCode);
    return route.fulfill({json:{id:upi?'ch_upi':'ch_card',returnUrl:'http://localhost:4317/?checkout=returned',...(b.promoCode?{promoCode:code,welcome:true}:{}),
      regional:{...india,price:4.99,days:30,pass:true,...(upi?{rupees:469,method:'upi'}:{})}}});});
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/?plans');
  await page.getByRole('button',{name:'or pay $4.99 by card'}).click();
  await expect(page.locator('.welcome-applied')).toContainText('($2.99 instead of $4.99)');
  await page.locator('.upi-switch').getByRole('button',{name:'Pay by UPI'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Paying ₹281.40 by UPI');
  await expect(page.locator('.welcome-applied')).toContainText('(₹281.40 instead of ₹469)');
  await expect(page.locator('.regional-applied')).toContainText('Price for India: ₹469 for 30 days');
  await expect(page.locator('.regional-applied')).not.toContainText('Pay with a card');
  expect(bodies).toEqual([{tier:'monthly',promoCode:code},{tier:'monthly',promoCode:code,method:'upi'}]);

  codeOnUpi=false;
  await page.locator('.upi-switch').getByRole('button',{name:'Pay by card instead'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Pay by UPI instead: ₹469');
  await page.locator('.upi-switch').getByRole('button',{name:'Pay by UPI'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Your welcome code works on card payments only');
  await expect(page.locator('.regional-applied')).toContainText('Pay with a card issued in India');
  await page.locator('.upi-switch').getByRole('button',{name:'Pay ₹469 by UPI'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Paying ₹469 by UPI');
  await expect(page.locator('.welcome-applied')).toHaveCount(0);
  expect(bodies.slice(2)).toEqual([{tier:'monthly',promoCode:code},{tier:'monthly',promoCode:code,method:'upi'},{tier:'monthly',method:'upi'}]);
});
const indiaPrice={region:'c',country:'IN',countryName:'India',monthly:{price:4.99,pass:true},yearly:{price:39.99,pass:true},upi:{monthly:469,yearly:3749}};
/** The events the page sent (the log batches them), by name. */
function captureEvents(page:Page){const sent:Array<[string,Record<string,unknown>]>=[];
  page.route('**/api/ev',route=>{for(const e of route.request().postDataJSON().ev as unknown[][]) sent.push([e[1] as string,(e[2]??{}) as Record<string,unknown>]);return route.fulfill({status:204,body:''});});return sent;}

test('in India the UPI pass is the lead button on each plan card: one tap opens the UPI checkout, and the events say so', async ({page}) => {
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Ravi',email:'ravi@example.com'},access:{active:false},billingReady:true,regionalPrice:indiaPrice}}));
  const sent=captureEvents(page);
  const bodies:Array<Record<string,unknown>>=[];
  await page.route('**/api/billing/checkout',route=>{const b=route.request().postDataJSON();bodies.push(b);
    return route.fulfill({json:{id:'ch_upi',returnUrl:'http://localhost:4317/?checkout=returned',regional:{...indiaPrice,price:4.99,days:30,pass:true,rupees:469,method:'upi'}}});});
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/?plans');
  const lead=page.locator('.membership-plan.rec');
  await expect(lead).toContainText('₹469');
  await expect(lead).toContainText('Smallest first payment');
  await expect(lead).toContainText('Google Pay, PhonePe, Paytm or any UPI app. No card needed.');
  await expect(page.locator('.membership-plan.yearly')).toContainText('₹312');
  await expect(page.locator('.membership-plan.yearly')).toContainText('Save ₹1,879');
  await expect(page.locator('.membership-plan.yearly')).toContainText('$39.99 by card');
  await expect(page.locator('.plans-value')).toContainText('600+ real patients');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/plans-india-390.png'});await expect(page.getByRole('button',{name:'Pay ₹469 with UPI'})).toBeInViewport();
  await page.getByRole('button',{name:'Pay ₹469 with UPI'}).click();
  await expect(page.locator('.upi-switch')).toContainText('Paying ₹469 by UPI');
  expect(bodies).toEqual([{tier:'monthly',method:'upi'}]);
  await page.getByRole('button',{name:'Change plan'}).click();
  await expect.poll(()=>sent.some(([n])=>n==='checkout_close'),{timeout:12000}).toBe(true);
  expect(sent.find(([n])=>n==='plans_view')![1]).toMatchObject({regional:true,pass:true,upi:true,rec:'monthly',monthly:4.99,yearly:39.99});
  expect(sent.find(([n])=>n==='plan_click')![1]).toEqual({period:'monthly',amount:4.99,method:'upi',rec:true,via:'plans'});
  expect(sent.find(([n])=>n==='checkout_close')![1]).toEqual({step:'loading'});
});

test('a visitor who is not signed in presses the UPI button and, once signed in, the checkout opens on UPI', async ({page}) => {
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true,regionalPrice:indiaPrice}}));
  await page.route('**/api/session',route=>route.fulfill({status:401,json:{user:null}}));
  await page.goto('/?plans');
  await page.getByRole('button',{name:'Pay ₹3,749 with UPI'}).click();
  await expect(page.getByRole('dialog',{name:/account|free/i})).toBeVisible();
  expect(await page.evaluate(()=>[sessionStorage.getItem('rvm:selected-plan'),sessionStorage.getItem('rvm:selected-plan-method')])).toEqual(['yearly','upi']);
});

test('another country with one-time passes leads with the 30-day pass and no UPI; a student sees the card price, not UPI', async ({page}) => {
  const ph={region:'c',country:'PH',countryName:'the Philippines',monthly:{price:5.99,pass:true},yearly:{price:47.99,pass:true},student:{monthly:4.19,yearly:33.59}};
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({json:{user:{name:'Ana',email:'ana@example.com'},access:{active:false},billingReady:true,regionalPrice:ph}}));
  const sent=captureEvents(page);
  await page.goto('/?plans');
  await expect(page.locator('.membership-plan.rec')).toHaveClass(/monthly/);
  await expect(page.getByRole('button',{name:'Get 30 days'})).toBeVisible();
  await expect(page.getByText('with UPI')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/plans-ph-390.png'});
  await expect.poll(()=>sent.some(([n])=>n==='plans_view'),{timeout:12000}).toBe(true);
  expect(sent.find(([n])=>n==='plans_view')![1]).toMatchObject({upi:false,rec:'monthly'});
});

test('the welcome email’s link, opened signed out, keeps the price for the visitor’s country and asks to sign in', async ({page}) => {
  // The 24-hour welcome email links to /?plans&promo=welcome-…; it usually opens outside Instagram's browser, signed out.
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true,
    regionalPrice:{region:'c',country:'IN',countryName:'India',monthly:{price:4.99,pass:true},yearly:{price:39.99,pass:true},upi:{monthly:469,yearly:3749}}}}));
  await page.route('**/api/session',route=>route.fulfill({status:401,json:{user:null}}));
  const checkouts:unknown[]=[];
  await page.route('**/api/billing/checkout',route=>{checkouts.push(route.request().postDataJSON());return route.fulfill({status:401,json:{error:'Please sign in.'}});});
  await page.goto('/?plans&promo=welcome-TEST');
  const panel=page.locator('#plans');
  const plans=page.locator('.membership-plan');
  await expect(plans.nth(1)).toContainText('₹469 for 30 days');
  await expect(plans.nth(1)).toContainText('$4.99 by card');
  await expect(plans.first()).toContainText('₹3,749 for a year');
  await expect(panel).not.toContainText('$20 billed every 30 days');
  await expect(panel).not.toContainText('$20 a month or $150 a year');
  await expect(page.locator('.regional-price')).toContainText('Your welcome code works on these prices');
  await expect(page.locator('.promo-entry')).toContainText('This is the welcome code from your email. It works once you sign in with the email it was sent to.');
  await expect(page.locator('#membership-promo')).toHaveValue('welcome-TEST');
  await page.setViewportSize({width:390,height:844});
  await panel.screenshot({path:'test-results/welcome-link-signed-out.png'});
  await page.getByRole('button',{name:'Pay ₹469 with UPI'}).click();
  const dialog=page.getByRole('dialog',{name:'Welcome back.'});
  await expect(dialog.getByRole('tab',{name:'Sign in'})).toHaveAttribute('aria-selected','true');
  await expect(dialog).toContainText('Sign in with the email your welcome code was sent to.');
  await expect(dialog).toContainText('Monthly · $4.99 for 30 days');
  expect(checkouts).toEqual([]);
});
test('a free account is asked one question on the plans, once: what would make it worth paying for', async ({page}) => {
  await account(page, true);
  const answers:unknown[]=[];
  await page.route('**/api/ev',route=>{answers.push(...(route.request().postDataJSON().ev as unknown[][]).filter((e)=>e[1]==='survey'));return route.fulfill({status:204,body:''});});
  await page.goto('/?plans');
  const q=page.getByRole('region',{name:'One question'});
  await expect(q).toContainText('what would make it worth paying for?');
  await q.getByRole('button',{name:'Paying without a card (UPI…)'}).click();
  await expect(q).toContainText('Thank you');
  await expect.poll(()=>answers.length,{timeout:12000}).toBe(1);
  expect((answers[0] as unknown[])[2]).toEqual({q:'plans_worth',a:'upi'});
  await page.reload();
  await expect(page.getByRole('button',{name:'Choose monthly'})).toBeVisible();
  await expect(page.getByRole('region',{name:'One question'})).toHaveCount(0);
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
  await page.getByRole('button',{name:'More sections'}).click();
  await expect(page.getByRole('menuitem',{name:/^Book(?! exams)/})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:/^Book(?! exams)/}).locator('.nav-lock')).toHaveCount(0);
  await expect(page.getByRole('menuitem',{name:/^Drills/}).locator('.nav-lock')).toHaveCount(1);
  await page.keyboard.press('Escape');
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
