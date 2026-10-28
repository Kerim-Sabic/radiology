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
  await expect(page.getByRole('link',{name:'Continue with email'})).toHaveAttribute('href','/api/auth/email');
  await expect(page.getByRole('button',{name:'Choose monthly'})).toBeDisabled();
  await expect(page.getByText('$10',{exact:false})).toHaveCount(2);
  expect(dataRequests).toEqual([]);
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
  await expect(page.getByRole('button',{name:'Get lifetime access'})).toBeVisible();
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
  await expect(page.getByRole('button',{name:'Get lifetime access'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/membership-mobile.png',fullPage:true});
});
