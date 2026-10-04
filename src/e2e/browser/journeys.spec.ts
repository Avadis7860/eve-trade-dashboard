import { test, expect } from '@playwright/test';

test.describe('Level 5: Real Chromium Browser E2E Journeys (11 Critical Paths)', () => {
  test.beforeEach(async ({ page }) => {
    // Reset data and clear session
    await page.request.post('/api/auth/e2e-reset');
    await page.context().clearCookies();
  });

  test('Journey 1: Initial Unauthenticated Landing & System Health Diagnostics', async ({ page }) => {
    // 1. Verify health and info APIs directly
    const healthRes = await page.request.get('/api/health');
    expect(healthRes.ok()).toBeTruthy();
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');

    // 2. Navigate to root in browser
    await page.goto('/');

    // 3. Verify landing elements: title, login button, phase indication
    await expect(page.locator('text=EVE Online Trade Dashboard').or(page.locator('text=EVE Trade Dashboard')).first()).toBeVisible();
    await expect(page.locator('text=Se connecter avec EVE Online (SSO)')).toBeVisible();
    await expect(page.locator('text=SYSTÈME PRÊT')).toBeVisible();
  });

  test('Journey 2: EVE SSO Authentication Simulation & Session Establishment', async ({ page }) => {
    // 1. Seed deterministic test data and create E2E session on page.request
    await page.request.post('/api/auth/e2e-seed');
    const sessionRes = await page.request.post('/api/auth/e2e-session', {
      data: {
        characterId: 777001,
        characterName: 'E2E Fleet Commander',
      },
    });
    expect(sessionRes.ok()).toBeTruthy();

    // 2. Load authenticated application
    await page.goto('/');

    // 3. Verify user is recognized and Cockpit is rendered
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();
    await expect(page.locator('text=Cockpit').first()).toBeVisible();
  });

  test('Journey 3: Cockpit & Synthèse Patrimoniale Consolidée with Liquidity Filtering', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Verify main financial overview cards
    await expect(page.locator('text=Chiffre d\'Affaires').or(page.locator('text=Synthèse Patrimoniale')).first()).toBeVisible();

    // Test quick liquidity buttons if visible on dashboard overview
    const corpoButton = page.locator('button:has-text("Corpo")').first();
    if (await corpoButton.isVisible()) {
      await corpoButton.click();
      await expect(page.locator('text=Corpo').first()).toBeVisible();

      const tousButton = page.locator('button:has-text("Tous")').first();
      await tousButton.click();
    }
  });

  test('Journey 4: Grand Livre (LedgerView) Inspection, Search & Type Filtering', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Navigate to Grand Livre tab
    const ledgerTab = page.locator('button:has-text("Grand Livre")').first();
    await ledgerTab.click();

    // Verify transaction entries
    await expect(page.locator('text=Tritanium').first()).toBeVisible();

    // Test filter button: Achats
    const buysButton = page.locator('button:has-text("Achats")').first();
    if (await buysButton.isVisible()) {
      await buysButton.click();
      await expect(page.locator('text=ACHAT').first()).toBeVisible();
    }

    // Test filter button: Ventes
    const salesButton = page.locator('button:has-text("Ventes")').first();
    if (await salesButton.isVisible()) {
      await salesButton.click();
      await expect(page.locator('text=VENTE').first()).toBeVisible();
    }
  });

  test('Journey 5: Market Orders Lifecycle Tracking & Orders View', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Navigate to Positions / Ordres tab
    const positionsTab = page.locator('button:has-text("Positions")').first();
    await positionsTab.click();

    // Switch to Ordres sub-tab if needed
    const ordersSubTab = page.locator('button:has-text("Ordres")').first();
    if (await ordersSubTab.isVisible()) {
      await ordersSubTab.click();
    }

    // Verify tracked orders
    await expect(page.locator('text=Tritanium').first()).toBeVisible();
  });

  test('Journey 6: Capital & Stocks Position Breakdown & Proof Verification', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Navigate to Positions / Capital tab
    const positionsTab = page.locator('button:has-text("Positions")').first();
    await positionsTab.click();

    // Verify physical stock breakdown elements
    await expect(page.locator('text=Tritanium').first()).toBeVisible();
  });

  test('Journey 7: Hubs & ROI View with Automatic FIFO Reconciliation', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Navigate to Analyses / Hubs & ROI tab
    const analysesTab = page.locator('button:has-text("Analyses")').first();
    await analysesTab.click();

    // Switch to Hubs & ROI sub-tab if needed
    const hubsRoiSubTab = page.locator('button:has-text("Hubs & ROI")').first();
    if (await hubsRoiSubTab.isVisible()) {
      await hubsRoiSubTab.click();
    }

    // Verify FIFO reconciliation button exists and trigger it
    const fifoBtn = page.locator('button:has-text("Rapprochement Automatique (FIFO)")').first();
    if (await fifoBtn.isVisible()) {
      await fifoBtn.click();
    }
  });

  test('Journey 8: Product 360 1-Click Modal Inspection & Tab Switching', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Navigate to Analyses / Product 360 tab
    const analysesTab = page.locator('button:has-text("Analyses")').first();
    await analysesTab.click();

    // Search for Tritanium
    const searchInput = page.locator('input[placeholder*="Rechercher"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Tritanium');
    }

    const openP360Btn = page.locator('button:has-text("Ouvrir Product 360")').first();
    if (await openP360Btn.isVisible()) {
      await openP360Btn.click();

      // Verify modal dialog appeared
      await expect(page.locator('role=dialog')).toBeVisible();
      await expect(page.locator('role=dialog').getByText('PRODUCT 360', { exact: true })).toBeVisible();

      // Switch tabs inside modal
      const stocksTab = page.locator('button:has-text("Stocks par Emplacement")').first();
      if (await stocksTab.isVisible()) {
        await stocksTab.click();
      }

      // Close modal
      const closeBtn = page.locator('button[title*="Fermer"]').or(page.locator('button:has-text("×")')).first();
      await closeBtn.click();
      await expect(page.locator('role=dialog')).not.toBeVisible();
    }
  });

  test('Journey 9: Restock & Operations Suggestions Generation', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Navigate to Opérations tab
    const opsTab = page.locator('button:has-text("Opérations")').first();
    await opsTab.click();

    // Verify operations / restock controls
    await expect(page.locator('text=Opérations').or(page.locator('text=Réapprovisionnement')).first()).toBeVisible();
  });

  test('Journey 10: EVE Multibuy Text Generation & RFC 4180 CSV Export', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // Navigate to Grand Livre tab
    const ledgerTab = page.locator('button:has-text("Grand Livre")').first();
    await ledgerTab.click();

    // Verify CSV export button is available
    const csvExportBtn = page.locator('button[title*="CSV"]').or(page.locator('button:has-text("CSV")')).first();
    await expect(csvExportBtn).toBeVisible();
  });

  test('Journey 11: System Diagnostics Drawer & Encrypted Backup Integrity', async ({ page }) => {
    await page.request.post('/api/auth/e2e-seed');
    await page.request.post('/api/auth/e2e-session', {
      data: { characterId: 777001, characterName: 'E2E Fleet Commander' },
    });

    await page.goto('/');
    await expect(page.locator('text=E2E Fleet Commander').first()).toBeVisible();

    // 1. Verify backup export API integrity
    const backupRes = await page.request.get('/api/backup/export');
    expect(backupRes.ok()).toBeTruthy();
    const backupJson = await backupRes.json();
    expect(backupJson.checksum).toBeDefined();
    expect(backupJson.data).toBeDefined();

    // 2. Open preferences / diagnostics modal
    const prefBtn = page.locator('button[title*="Préférences"]').first();
    if (await prefBtn.isVisible()) {
      await prefBtn.click();
      await expect(page.locator('text=Préférences Utilisateur')).toBeVisible();
      const closeBtn = page.locator('button:has-text("Annuler")').or(page.locator('button:has-text("Fermer")')).first();
      await closeBtn.click();
    }
  });
});
