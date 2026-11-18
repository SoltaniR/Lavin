// Run in a signed-in English browser against a disposable data directory.
async (page) => {
  const origin = new URL(page.url()).origin;
  const saved = origin + '/?view=companies';
  const stamp = Date.now();
  const firstName = `Z Repair Studio ${stamp}`;
  const secondName = `A Review Studio ${stamp}`;

  async function createReport(name, year) {
    await page.goto(origin + '/?view=setup');
    await page.getByLabel('Business name').fill(name);
    await page.getByLabel('Reporting year').selectOption(year);
    await page.getByRole('button', { name: 'Next: your records', exact: true }).click();
    await page.getByRole('button', { name: 'Create report and add documents', exact: true }).click();
    await page.waitForURL(origin + '/?view=documents');
  }

  const row = name => page.getByRole('article', { name, exact: true });
  const dialog = page.getByRole('dialog');
  async function moveToTrash(name) {
    await row(name).getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.getByRole('heading', { name: new RegExp(name) }).waitFor();
    await dialog.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
    await row(name).waitFor({ state: 'detached' });
  }

  await createReport(firstName, '2025');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/sample-bank.mt940');
  await page.getByRole('button', { name: 'Upload and read', exact: true }).click();
  await page.getByText('sample-bank.mt940', { exact: true }).waitFor();
  await page.locator('details.document summary').click();
  const source = await page.getByRole('link', { name: 'View original', exact: true }).getAttribute('href');
  await page.goto(origin + '/?view=review');
  await page.getByLabel('Description', { exact: true }).fill('Fictional archive invoice');
  await page.getByLabel('Total amount, including VAT').fill('121');
  await page.getByLabel('VAT amount shown').fill('21');
  await page.getByRole('button', { name: 'Record entry', exact: true }).click();
  await page.getByText('Saved successfully.', { exact: true }).waitFor();
  await createReport(secondName, '2026');

  await page.goto(saved);
  await page.getByRole('combobox', { name: 'Filter by year', exact: true }).selectOption('2025');
  await row(firstName).waitFor();
  await row(secondName).waitFor({ state: 'detached' });
  await page.getByRole('combobox', { name: 'Filter by year', exact: true }).selectOption('');
  await page.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('name');
  const names = await page.locator('.company-row h2').allTextContents();
  if (names.indexOf(secondName) >= names.indexOf(firstName)) throw new Error('Company sort did not apply');
  await row(firstName).getByRole('button', { name: 'View figures', exact: true }).click();
  await page.waitForURL(origin + '/?view=report');
  await page.locator('.report-paper').getByRole('heading', { name: firstName, exact: true }).waitFor();
  const [selection] = await page.context().cookies(origin).then(cookies => cookies.filter(c => c.name === 'business'));
  if (!selection || !source) throw new Error('Missing report selection or source');

  const earlierTab = await page.context().newPage();
  await earlierTab.goto(origin + '/?view=review');
  await earlierTab.getByLabel('Description', { exact: true }).fill('Stale save must fail');
  await earlierTab.getByLabel('Total amount, including VAT').fill('100');
  await page.goto(saved);
  await row(firstName).getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await row(firstName).waitFor();
  await page.getByRole('combobox', { name: 'Filter by year', exact: true }).selectOption('2025');
  await moveToTrash(firstName);
  const yearFilter = page.getByRole('combobox', { name: 'Filter by year', exact: true });
  if (await yearFilter.inputValue() !== '2025') throw new Error('Delete changed the selected year filter');
  await yearFilter.selectOption('');
  await row(secondName).waitFor();

  await page.context().addCookies([selection]);
  if ((await page.request.get(origin + source)).ok()) throw new Error('Trashed report document was downloadable');
  if ((await page.request.get(origin + '/api/export')).ok()) throw new Error('Trashed report CSV was downloadable');
  await earlierTab.getByRole('button', { name: 'Record entry', exact: true }).click();
  await Promise.race([
    earlierTab.waitForURL(saved),
    earlierTab.locator('.entry-panel .feedback.error').waitFor(),
  ]);
  await earlierTab.close();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await row(firstName).waitFor();
  await moveToTrash(firstName);
  await page.getByRole('link', { name: 'Trash', exact: true }).click();
  await row(firstName).waitFor();
  await row(secondName).waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'NL', exact: true }).click();
  await page.getByRole('heading', { name: 'Prullenbak', exact: true }).waitFor();
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) throw new Error('Trash view overflows on mobile');
  await row(firstName).getByRole('button', { name: 'Rapport terugzetten', exact: true }).click();
  await row(firstName).waitFor({ state: 'detached' });
  await page.getByRole('link', { name: 'Terug naar opgeslagen rapporten', exact: true }).click();
  await row(firstName).getByRole('button', { name: 'Cijfers bekijken', exact: true }).click();
  await page.waitForURL(origin + '/?view=report');
  await page.locator('.report-paper').getByText('100,00', { exact: false }).first().waitFor();
  if (!(await page.request.get(origin + source)).ok()) throw new Error('Restored report lost the original document');
  const csv = await page.request.get(origin + '/api/export').then(response => response.text());
  if (!csv.includes('Fictional archive invoice') || csv.includes('Stale save must fail')) throw new Error('Journal changed during Trash/Restore');
};
