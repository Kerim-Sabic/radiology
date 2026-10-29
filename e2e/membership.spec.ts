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
  await expect(page.getByText('$20',{exact:false})).toBeVisible();
  await expect(page.getByText('$150',{exact:false})).toHaveCount(2);
  expect(dataRequests).toEqual([]);
  await page.getByRole('button',{name:'Choose yearly'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Yearly · $150 / year');
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
  await page.getByRole('button',{name:'Choose yearly'}).click();
  await page.getByRole('button',{name:'Continue with email'}).click();
  await expect(page.getByRole('heading',{name:'Your study space is almost ready.'})).toBeVisible();
  expect(tier).toEqual({tier:'yearly'});
  expect(new URL(page.url()).origin).toBe('http://localhost:4317');
  await expect(page.getByRole('dialog')).not.toBeVisible();
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
  await page.goto('/');
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
  await expect(page.getByRole('button',{name:'Choose yearly'})).toBeVisible();
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
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Choose yearly'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/membership-mobile.png',fullPage:true});
});

test('a promo code survives signup and reaches the on-page monthly checkout', async ({page, context}) => {
  let signedIn = false;
  await page.route('**/api/config',route=>route.fulfill({json:{auth:true,billing:true}}));
  await page.route('**/api/session',route=>route.fulfill({status:signedIn?200:401,json:signedIn?{user:{name:'Member',email:'member@example.com'},access:{active:false},billingReady:true}:{user:null}}));
  await context.route('**/api/auth/email',route=> { signedIn=true; return route.fulfill({contentType:'text/html',body:`<script>opener.postMessage({type:'rvm-auth',ok:true},location.origin);window.close();</script>`}); });
  let submitted: unknown;
  await page.route('**/api/billing/checkout',route=>{submitted=route.request().postDataJSON();return route.fulfill({json:{id:'ch_promo',promoCode:'nadin',returnUrl:'http://localhost:4317/?checkout=returned'}});});
  await page.route('**/*whop.com/**',route=>route.abort());
  await page.goto('/');
  await page.getByText('Have a promo code?',{exact:true}).click();
  await page.getByLabel('Promo code',{exact:true}).fill('NADIN');
  await page.getByRole('button',{name:'Choose monthly'}).click();
  await page.getByRole('button',{name:'Continue with email'}).click();
  await expect(page.getByRole('heading',{name:'Your study space is almost ready.'})).toBeVisible();
  expect(submitted).toEqual({tier:'monthly',promoCode:'NADIN'});
  await expect(page.getByText('Your code is prefilled',{exact:false})).toBeVisible();
});
