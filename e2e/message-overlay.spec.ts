import { expect, test, type Page } from '@playwright/test';

const MESSAGE_COUNT = 49_000;
const SOURCE = 'Thanh Dii_0.json';

/** A standalone Messenger export whose files live in page memory and record writes. */
async function installLargeExport(page: Page) {
  await page.addInitScript(({ count, source }) => {
    const words = ['lỗi', 'mạng', 'đường', 'hôm nay', 'ăn cơm', 'chưa', 'ok', 'Đi chơi', 'ảnh', 'video'];
    const newest = 1_760_199_384_846;
    const raw = JSON.stringify({
      participants: ['Quoc Duy', 'Thanh Dii'],
      threadName: 'Thanh Dii',
      messages: Array.from({ length: count }, (_, index) => ({
        isUnsent: index % 997 === 5,
        media: index === 0 ? [{ uri: 'Failed to download media' }] : [],
        reactions: [],
        senderName: index % 2 ? 'Quoc Duy' : 'Thanh Dii',
        text: index === 0 ? '' : index === 1 ? 'tin cuối cùng để xóa' : `${words[index % words.length]} tin nhắn số ${index}`,
        timestamp: newest - index * 61_000,
        type: 'text',
      })),
    });
    const files = new Map<string, string>([[source, raw]]);
    const writes: string[] = [];
    const file = (name: string) => ({
      kind: 'file' as const,
      name,
      async getFile() { return new File([files.get(name) ?? ''], name, { type: 'application/json' }); },
      async createWritable() {
        let next = '';
        return {
          async write(value: unknown) { next = typeof value === 'string' ? value : await (value as Blob).text(); },
          async close() { files.set(name, next); writes.push(name); },
        };
      },
    });
    const media = { kind: 'directory' as const, name: 'media', async *entries() {}, async getFileHandle() { throw new DOMException('Missing', 'NotFoundError'); }, async getDirectoryHandle() { throw new DOMException('Missing', 'NotFoundError'); } };
    const root = {
      kind: 'directory' as const,
      name: 'export',
      async getDirectoryHandle(name: string) {
        if (name === 'media') return media;
        throw new DOMException('Missing directory', 'NotFoundError');
      },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!files.has(name)) {
          if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');
          files.set(name, '');
        }
        return file(name);
      },
      async removeEntry(name: string) { files.delete(name); },
      async queryPermission() { return 'granted' as PermissionState; },
      async requestPermission() { return 'granted' as PermissionState; },
      async *entries() {
        yield ['media', media] as const;
        for (const name of [...files.keys()]) yield [name, file(name)] as const;
      },
    };
    localStorage.setItem(`majv_${location.hostname}_setting_dontShowTrustModal`, '1');
    localStorage.setItem(`majv_${location.hostname}_setting_offlineSupportEnabled`, '0');
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
    Object.defineProperty(window, '__overlayTest', { configurable: true, value: { files, writes, raw } });
  }, { count: MESSAGE_COUNT, source: SOURCE });
}

function readFiles(page: Page) {
  return page.evaluate(async () => {
    const { files, writes, raw } = (window as unknown as { __overlayTest: { files: Map<string, string>; writes: string[]; raw: string } }).__overlayTest;
    const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    return {
      names: [...files.keys()].sort(),
      writes: [...writes],
      sourceHash: await hash(files.get('Thanh Dii_0.json') ?? ''),
      originalHash: await hash(raw),
      overlay: files.get('Thanh Dii_0.overlay.json'),
      cleaned: files.get('Thanh Dii_0.cleaned.json'),
    };
  });
}

test('loads, searches and edits a 49k-message thread without changing its source file', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await installLargeExport(page);
  await page.goto('');
  await page.getByRole('button', { name: /Select messages folder|Select folder/ }).click();
  const chat = page.locator('.chat-list-item').filter({ hasText: 'Thanh Dii' });
  await expect(chat).toBeVisible({ timeout: 30_000 });
  // The overlay and cleaned files must never appear as conversations.
  await expect(page.locator('.chat-list-item')).toHaveCount(1);

  const loadStart = Date.now();
  await chat.click();
  await expect(page.locator('#chat:not([data-opening])')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.message-wrapper').getByText('tin cuối cùng để xóa')).toBeVisible();
  const loadMs = Date.now() - loadStart;

  // Let the idle index build finish, as it would while the user reads.
  await page.waitForTimeout(1500);
  const search = page.getByRole('searchbox', { name: 'Search messages' });
  await search.fill('LOI');
  const searchStart = Date.now();
  await search.press('Enter');
  const summary = page.locator('.search-result-summary');
  await expect(summary).toContainText('4,900 kết quả');
  const searchMs = Date.now() - searchStart;

  testInfo.annotations.push({ type: 'load-ms', description: String(loadMs) }, { type: 'search-ms', description: String(searchMs) });
  console.log(`49k thread: load ${loadMs} ms, search ${searchMs} ms`);
  expect(loadMs).toBeLessThan(3_000);
  expect(searchMs).toBeLessThan(300);

  // Failed media is labelled and searchable.
  await expect(page.locator('.message-wrapper').getByRole('img', { name: '⚠ Media tải lỗi' })).toBeVisible();

  // Favorite, then delete the newest text message from its hover tools.
  const target = page.locator('.message').filter({ hasText: 'tin cuối cùng để xóa' });
  await target.hover();
  await target.getByRole('button', { name: 'Favorite' }).click();
  await expect(target).toHaveClass(/is-favorite/);
  await target.hover();
  await target.getByRole('button', { name: 'Xóa tin nhắn' }).click();
  await expect(page.locator('.overlay-toast')).toContainText('Đã xóa 1 tin nhắn');
  await expect(page.locator('.message-wrapper').getByText('tin cuối cùng để xóa')).toHaveCount(0);

  await expect.poll(async () => (await readFiles(page)).overlay, { timeout: 5_000 }).toBeTruthy();
  let files = await readFiles(page);
  const overlay = JSON.parse(files.overlay!);
  expect(overlay).toMatchObject({ version: 1, sourceFile: SOURCE });
  expect(overlay.deleted).toHaveLength(1);
  expect(overlay.favorites).toHaveLength(1);

  // Deleted messages drop out of search.
  await search.fill('cuoi cung');
  await search.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText('No results');

  // Export the cleaned copy from the "Đã xóa" panel.
  await page.getByRole('button', { name: 'Tin nhắn đã xóa' }).click();
  await expect(page.getByRole('complementary', { name: 'Tin nhắn đã xóa' })).toContainText('tin cuối cùng để xóa');
  await page.getByRole('button', { name: 'Export bản sạch' }).click();
  await expect(page.getByRole('complementary', { name: 'Tin nhắn đã xóa' })).toContainText('Đã ghi Thanh Dii_0.cleaned.json (bỏ 1 tin)');

  files = await readFiles(page);
  expect(JSON.parse(files.cleaned!).messages).toHaveLength(MESSAGE_COUNT - 1);
  expect(files.names).toEqual(['Thanh Dii_0.cleaned.json', 'Thanh Dii_0.json', 'Thanh Dii_0.overlay.json']);
  expect(files.writes.every(name => name !== SOURCE)).toBe(true);
  expect(files.sourceHash).toBe(files.originalHash);
});
