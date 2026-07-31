/**
 * CRUD e2e — drives the real UI (desktop + mobile projects):
 * every entity can be added, edited and removed where it makes sense.
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '1234';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test.describe('Patients CRUD', () => {
  test('add → edit → delete a patient', async ({ page }) => {
    const stamp = Date.now().toString().slice(-8);
    const name = `E2E Paciente ${stamp}`;
    await signIn(page);
    await page.goto('/patients');

    // create
    await page.getByTestId('new-patient').click();
    await page.getByTestId('patient-name').fill(name);
    await page.locator('input[type="date"]').first().fill('1990-04-12');
    await page.locator('form input[placeholder="+5511999999999"]').fill(`+5511988${stamp.slice(0, 6)}`);
    await page.locator('form input[type="checkbox"]').check();
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('cell', { name })).toBeVisible({ timeout: 10_000 });

    // edit
    const row = page.getByRole('row', { name: new RegExp(stamp) });
    await row.getByRole('button', { name: /editar|edit/i }).click();
    await page.getByTestId('patient-name').fill(`${name} Editado`);
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('cell', { name: `${name} Editado` })).toBeVisible({ timeout: 10_000 });

    // delete
    const editedRow = page.getByRole('row', { name: new RegExp(`${stamp}`) });
    await editedRow.getByRole('button', { name: /excluir|eliminar|delete/i }).click();
    await page.getByTestId('confirm-delete').click();
    await expect(page.getByRole('cell', { name: `${name} Editado` })).toHaveCount(0, { timeout: 10_000 });
  });
});

test.describe('Inventory (meds) CRUD + real stock', () => {
  test('item + batch + stock out actually decrements stock', async ({ page }) => {
    const stamp = Date.now().toString().slice(-8);
    const sku = `E2E-${stamp}`;
    const name = `Dipirona E2E ${stamp}`;
    await signIn(page);
    await page.goto('/inventory');

    // create item
    await page.getByTestId('new-item').click();
    await page.getByTestId('item-sku').fill(sku);
    await page.getByTestId('item-name').fill(name);
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('cell', { name })).toBeVisible({ timeout: 10_000 });

    // add a batch of 100
    await page.getByRole('button', { name: /lote/i }).click();
    await page.getByTestId('new-batch').click();
    const itemValue = await page.locator('select').first().evaluate(
      (sel: HTMLSelectElement, s: string) => [...sel.options].find((o) => o.label.includes(s))?.value ?? '', stamp,
    );
    await page.locator('select').first().selectOption(itemValue);
    await page.locator('input').nth(0).fill(`L${stamp}`);
    await page.locator('input[type="date"]').fill('2027-12-31');
    await page.locator('input[type="number"]').nth(0).fill('100');
    await page.locator('input[type="number"]').nth(1).fill('0.50');
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('cell', { name: `L${stamp}` })).toBeVisible({ timeout: 10_000 });

    // stock now 100
    await page.getByRole('button', { name: /estoque|inventory|itens/i }).first().click();
    const itemRow = page.getByRole('row', { name: new RegExp(stamp) });
    await expect(itemRow.getByRole('cell').nth(4)).toHaveText('100');

    // stock out 30 via FEFO
    await page.getByRole('button', { name: /movimenta/i }).click();
    await page.getByTestId('new-movement').click();
    const itemValue2 = await page.locator('select').first().evaluate(
      (sel: HTMLSelectElement, s: string) => [...sel.options].find((o) => o.label.includes(s))?.value ?? '', stamp,
    );
    await page.locator('select').first().selectOption(itemValue2);
    await page.locator('input[type="number"]').fill('30');
    await page.getByTestId('form-submit').click();

    // stock now 70
    await page.getByRole('button', { name: /estoque|inventory|itens/i }).first().click();
    const itemRow2 = page.getByRole('row', { name: new RegExp(stamp) });
    await expect(itemRow2.getByRole('cell').nth(4)).toHaveText('70');

    // delete the item
    await itemRow2.getByRole('button', { name: /excluir|eliminar|delete/i }).click();
    await page.getByTestId('confirm-delete').click();
    await expect(page.getByRole('cell', { name })).toHaveCount(0, { timeout: 10_000 });
  });
});

test.describe('WhatsApp inbox', () => {
  test('staff sends a message and deletes the conversation', async ({ page }) => {
    const stamp = Date.now().toString().slice(-6);
    const phone = `+5511977${stamp}`;
    await signIn(page);
    await page.goto('/whatsapp');

    // start a new chat and send as clinic
    await page.getByTestId('new-chat').click();
    await page.getByTestId('new-chat-phone').fill(phone);
    await page.getByTestId('form-submit').click();
    await page.getByTestId('mode-send').click();
    await page.getByTestId('chat-input').fill('Olá, confirma sua consulta?');
    await page.getByTestId('chat-send').click();
    await expect(page.getByText('Olá, confirma sua consulta?')).toBeVisible({ timeout: 10_000 });

    // delete the conversation
    const conv = page.locator('.group', { hasText: phone });
    await conv.hover();
    await conv.getByRole('button').nth(1).click();
    await page.getByTestId('confirm-delete').click();
    await expect(page.getByText(phone)).toHaveCount(0, { timeout: 10_000 });
  });
});
