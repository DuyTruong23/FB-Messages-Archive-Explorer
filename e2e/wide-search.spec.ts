import { expect, test, type Page } from '@playwright/test';

import { installArchive } from './helpers/archive';

function storedIndexCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('fb-mae-search-index');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('indexes')) { db.close(); resolve(0); return; }
      const count = db.transaction('indexes', 'readonly').objectStore('indexes').count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); reject(count.error); };
    };
  }));
}

async function searchAll(page: Page, query: string) {
  await page.goto('');
  await page.getByRole('button', { name: /Select messages folder|Select folder/ }).click();
  await expect(page.locator('.chat-list-item').filter({ hasText: 'Alice Chat' })).toBeVisible();
  const scope = page.getByRole('button', { name: 'Toggle search scope' });
  if (await scope.getAttribute('aria-pressed') !== 'true') await scope.click();
  const search = page.getByRole('searchbox', { name: 'Search messages' });
  await search.fill(query);
  await search.press('Enter');
  return page.getByRole('listbox', { name: 'Search results' });
}

test('searches all chats in a worker and reuses stored indexes after reload', async ({ page }) => {
  await installArchive(page, 'facebook');

  const results = await searchAll(page, 'needle');
  await expect(results).toContainText('needle from Facebook');
  await expect(results).toContainText('Alice Chat');
  await expect.poll(() => storedIndexCount(page)).toBeGreaterThanOrEqual(2);

  const reloaded = await searchAll(page, 'keep this');
  await expect(reloaded).toContainText('keep this chat');
  await expect(reloaded).toContainText('Bob Chat');
});
