// Run in an authenticated browser against a disposable data directory.
async (page) => {
  const base = new URL(page.url()).origin;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const stamp = Date.now(), first = `Flow Studio ${stamp}`, second = `Other Studio ${stamp}`;
  async function home() {
    await page.goto(base);
    await page.getByRole('heading', {name:'What would you like to do?',exact:true}).waitFor();
    check(await page.locator('.business-chip').count() === 0, 'Home selected a company');
  }
  await home();
  check(await page.getByRole('button', {name:'Explore a sample business',exact:true}).isVisible() === false, 'Sample should be opt-in');
  await page.locator('.sample-option summary').click();
  await page.getByRole('button', {name:'Explore a sample business',exact:true}).click();
  await page.waitForURL(base+'/?view=overview');
  await page.locator('.business-chip').filter({hasText:'Studio Noord'}).waitFor();
  await home();
  await page.context().clearCookies({name:'business'});
  await page.goto(base+'/?view=overview');
  await page.waitForURL(base+'/?view=companies');
  check((await page.request.get(base+'/api/export')).status() === 404, 'Missing selection fell back to a company');

  async function start(name, detailed) {
    await home();
    await page.locator('.home-create').click();
    await page.getByRole('heading', {name:'Which company is this for?',exact:true}).waitFor();
    check(await page.getByLabel('Business name').inputValue() === '', 'New company inherited a name');
    await page.getByRole('button', {name:'Next: your records',exact:true}).click();
    await page.getByRole('heading', {name:'Which company is this for?',exact:true}).waitFor();
    await page.getByLabel('Business name').fill(name);
    await page.getByLabel('Reporting year').selectOption('2025');
    await page.getByLabel('Business name').press('Enter');
    await page.getByRole('heading', {name:'Tell us about your records',exact:true}).waitFor();
    await page.getByRole('button', {name:'Back to company details',exact:true}).click();
    check(await page.getByLabel('Business name').inputValue() === name, 'Back lost entered details');
    await page.getByRole('button', {name:'Next: your records',exact:true}).click();
    check(!await page.getByLabel('I accept cash payments').isChecked(), 'New company inherited flags');
    if (detailed) await page.getByLabel('I accept cash payments').check();
    await page.getByLabel('VAT accounting method').selectOption('invoice');
    await page.getByLabel('This is my first financial year').check();
    await page.getByRole('button', {name:'Create report and add documents',exact:true}).click();
    await page.waitForURL(base+'/?view=documents');
    check((await page.locator('.business-chip').innerText()).includes(name), 'Wrong company selected after creation');
    check((await page.locator('.report-steps [aria-current=step]').innerText()).includes('Documents'), 'Workflow step did not advance');
  }
  await start(first, true);
  for (const [label, view] of [['Bookkeeping','review'],['Year-end checks','yearend'],['Draft report','report']]) {
    await page.locator('.report-next').getByRole('link', {name:'Next: '+label,exact:true}).click();
    await page.waitForURL(base+'/?view='+view);
  }
  await page.getByRole('link', {name:'Back to saved reports',exact:true}).click();
  const firstRow = page.getByRole('article').filter({has:page.getByRole('heading', {name:first,exact:true})});
  await firstRow.getByRole('button', {name:'Edit details',exact:true}).click();
  await page.waitForURL(base+'/?view=business');
  check(await page.getByLabel('I accept cash payments').isChecked(), 'Created flags were not saved');
  await page.getByLabel('Business name').fill(first+' Revised');
  await page.getByRole('button', {name:'Save changes',exact:true}).click();
  await page.getByText('Saved successfully.', {exact:false}).waitFor();

  await start(second, false);
  await home();
  await page.getByRole('link', {name:/Edit company information/}).click();
  await page.getByLabel('Find a company or year').fill(first);
  check(await page.locator('.company-row').count() === 1, 'Search or edit created a duplicate report');
  await page.getByRole('button', {name:'Edit details',exact:true}).click();
  await page.waitForURL(base+'/?view=business');
  check(await page.getByLabel('Business name').inputValue() === first+' Revised', 'Edit did not persist to selected company');
  check(await page.getByLabel('I accept cash payments').isChecked(), 'Second company changed the first');
  await page.goto(base+'/?view=companies');
  await page.getByLabel('Find a company or year').fill(second);
  await page.getByRole('button', {name:'Open report',exact:true}).click();
  await page.waitForURL(base+'/?view=overview');
  check((await page.locator('.business-chip').innerText()).includes(second), 'Opening a saved report selected the wrong company');

  await home();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'output/playwright/home-en.png',fullPage:true});
  await page.getByRole('button', {name:'NL',exact:true}).click();
  await page.getByRole('heading', {name:'Wat wil je doen?',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/home-nl.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Home overflows mobile');
  await page.screenshot({path:'output/playwright/home-mobile.png',fullPage:true});
  await page.locator('.home-create').click();
  await page.getByRole('heading', {name:'Voor welk bedrijf is dit?',exact:true}).waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Setup overflows mobile');
  await page.screenshot({path:'output/playwright/setup-mobile.png',fullPage:true});
  await page.goto(base+'/?view=companies');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Picker overflows mobile');
  await page.screenshot({path:'output/playwright/companies-mobile.png',fullPage:true});
  await page.getByRole('button', {name:'EN',exact:true}).click();
  await page.getByLabel('Find a company or year').waitFor();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'output/playwright/companies-en.png',fullPage:true});
  await page.getByRole('button', {name:'Sign out',exact:true}).click();
  await page.waitForURL(base+'/login');
}
