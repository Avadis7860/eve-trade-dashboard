import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App.tsx';

describe('App Component (Phase 06 Integrated Dashboard)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('renders unauthenticated state with SSO login button and Phase 06 badge', async () => {
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      const pathname = new URL(urlStr, 'http://localhost').pathname;

      if (pathname === '/api/health') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            service: 'eve-trade-dashboard',
            timestamp: new Date().toISOString(),
            version: '0.1.0',
          }),
        } as Response);
      }
      if (pathname === '/api/auth/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ configured: true }),
        } as Response);
      }
      if (pathname === '/api/auth/session') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ authenticated: false }),
        } as Response);
      }
      if (pathname === '/api/esi/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rateLimit: {
              errorLimitRemain: 100,
              errorLimitResetSeconds: 0,
              isSuspended: false,
              suspendedUntil: 0,
              activeRequests: 0,
            },
            cacheSize: 0,
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unknown URL: ${pathname}`));
    });

    render(<App />);

    expect(screen.getAllByText(/EVE Trade Dashboard/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Phase 06 — Dashboard Intégré & Ergonomie/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Se connecter avec EVE Online \(SSO\)/i)).toBeInTheDocument();
    });
  });

  it('renders authenticated dashboard overview, navigates tabs, opens preferences and performs restock/csv actions', async () => {
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      const pathname = new URL(urlStr, 'http://localhost').pathname;

      if (pathname === '/api/health') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            service: 'eve-trade-dashboard',
            timestamp: new Date().toISOString(),
            version: '0.1.0',
          }),
        } as Response);
      }
      if (pathname === '/api/auth/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ configured: true }),
        } as Response);
      }
      if (pathname === '/api/auth/session') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            authenticated: true,
            character: {
              characterId: 2119876543,
              characterName: 'Captain Trader',
              portraitUrl: 'https://images.evetech.net/characters/2119876543/portrait?size=128',
              scopes: ['esi-wallet.read_character_wallet.v1', 'esi-markets.read_character_orders.v1'],
              expiresAt: Date.now() + 1200000,
            },
          }),
        } as Response);
      }
      if (pathname === '/api/auth/logout') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }
      if (pathname === '/api/esi/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rateLimit: {
              errorLimitRemain: 98,
              errorLimitResetSeconds: 0,
              isSuspended: false,
              suspendedUntil: 0,
              activeRequests: 0,
            },
            cacheSize: 3,
          }),
        } as Response);
      }
      if (pathname === '/api/ledger/transactions/50001') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            transaction: {
              id: '2119876543:50001',
              characterId: 2119876543,
              transactionId: 50001,
              date: '2026-09-20T10:00:00Z',
              typeId: 34,
              typeName: 'Tritanium',
              quantity: 100000,
              unitPrice: 5.5,
              totalValue: 550000,
              isBuy: true,
              isPersonal: true,
              journalRefId: 90001,
              locationId: 60003760,
              locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
              clientId: 2001,
              clientName: 'Supplier Corp',
              source: '/characters/2119876543/wallet/transactions/',
              observedAt: Date.now(),
            },
            relatedJournalEntries: [],
          }),
        } as Response);
      }
      if (pathname === '/api/ledger/transactions') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                id: '2119876543:50001',
                characterId: 2119876543,
                transactionId: 50001,
                date: '2026-09-20T10:00:00Z',
                typeId: 34,
                typeName: 'Tritanium',
                quantity: 100000,
                unitPrice: 5.5,
                totalValue: 550000,
                isBuy: true,
                isPersonal: true,
                journalRefId: 90001,
                locationId: 60003760,
                locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
                clientId: 2001,
                clientName: 'Supplier Corp',
                source: '/characters/2119876543/wallet/transactions/',
                observedAt: Date.now(),
              },
            ],
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
            freshness: 'FRESH',
          }),
        } as Response);
      }
      if (pathname === '/api/ledger/summary') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            characterId: 2119876543,
            asOf: Date.now(),
            totalTransactionsCount: 1,
            sellTransactionsCount: 0,
            buyTransactionsCount: 1,
            totalSellVolume: 0,
            totalBuyVolume: 100000,
            totalGrossSalesIsk: 0,
            totalBuySpendIsk: 550000,
            distinctItemsCount: 1,
            distinctLocationsCount: 1,
            completeness: 'COMPLETE',
          }),
        } as Response);
      }
      if (pathname === '/api/ledger/sync-status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            characterId: 2119876543,
            transactions: {
              status: 'COMPLETE',
              lastSyncCompletedAt: Date.now(),
              totalRecords: 1,
            },
            journal: {
              status: 'COMPLETE',
              totalRecords: 0,
            },
            orders: {
              status: 'COMPLETE',
              lastSyncCompletedAt: Date.now(),
              totalRecords: 1,
            },
            freshness: 'FRESH',
          }),
        } as Response);
      }
      if (pathname === '/api/ledger/filter-options') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            types: [{ id: 34, name: 'Tritanium', count: 1 }],
            locations: [{ id: 60003760, name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', count: 1 }],
          }),
        } as Response);
      }
      if (pathname === '/api/ledger/journal') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [], total: 0 }),
        } as Response);
      }
      if (pathname === '/api/ledger/sync') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }
      if (pathname === '/api/orders/summary') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            characterId: 2119876543,
            asOf: Date.now(),
            totalOrdersTracked: 1,
            activeOrdersCount: 1,
            partiallyFilledCount: 0,
            completedCount: 0,
            cancelledCount: 0,
            expiredCount: 0,
            disappearedCount: 0,
            totalActiveIskValue: 550000,
            totalActiveEscrowIsk: 0,
          }),
        } as Response);
      }
      if (pathname === '/api/orders/restock/generate') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            generated: 1,
            items: [
              {
                id: '2119876543:34:60008494',
                characterId: 2119876543,
                typeId: 34,
                typeName: 'Tritanium',
                targetBuyHubId: 60003760,
                targetBuyHubName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
                sellHubId: 60008494,
                sellHubName: 'Amarr VIII (Oris) - Emperor Family Academy',
                suggestedQuantity: 50000,
                targetQuantity: 50000,
                status: 'SUGGESTED',
                justification: 'Ordre de vente complété',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          }),
        } as Response);
      }
      if (pathname === '/api/orders/restock') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                id: '2119876543:34:60008494',
                characterId: 2119876543,
                typeId: 34,
                typeName: 'Tritanium',
                targetBuyHubId: 60003760,
                targetBuyHubName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
                sellHubId: 60008494,
                sellHubName: 'Amarr VIII (Oris) - Emperor Family Academy',
                suggestedQuantity: 50000,
                targetQuantity: 50000,
                status: 'SUGGESTED',
                justification: 'Ordre de vente complété',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          }),
        } as Response);
      }
      if (pathname === '/api/orders') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                id: '2119876543:101',
                characterId: 2119876543,
                orderId: 101,
                typeId: 34,
                typeName: 'Tritanium',
                regionId: 10000002,
                locationId: 60003760,
                locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
                isBuyOrder: false,
                price: 5.5,
                volumeTotal: 100000,
                volumeRemain: 60000,
                volumeFilled: 40000,
                issued: '2026-09-20T10:00:00Z',
                duration: 90,
                expiresAt: '2026-12-19T10:00:00Z',
                state: 'PARTIALLY_FILLED',
                stateJustification: 'Ordre partiellement exécuté : 40000/100000 unités',
                firstObservedAt: Date.now(),
                lastObservedAt: Date.now(),
                isActiveInCurrentSnapshot: true,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
          }),
        } as Response);
      }
      if (pathname === '/api/roi/summary') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            summary: {
              as_of: new Date().toISOString(),
              period_label: 'Toutes périodes',
              total_sales_volume: 40000,
              allocated_sales_volume: 40000,
              unallocated_sales_volume: 0,
              gross_revenue_isk: 220000,
              allocated_buy_cost_isk: 160000,
              allocated_buy_fees_isk: 4800,
              attributable_sell_fees_isk: 7920,
              total_allocated_investment_ttc: 164800,
              realized_profit_ttc_isk: 47280,
              roi_percent_ttc: 28.69,
              tied_up_capital_isk: 330000,
              unsold_items_count: 1,
              coverage_status: 'COMPLETE',
              coverage_percent: 100,
              hub_pairs: [
                {
                  buy_hub_id: 'hub-jita',
                  buy_hub_name: 'Jita 4-4',
                  sell_hub_id: 'hub-amarr',
                  sell_hub_name: 'Amarr 8',
                  sold_volume_total: 40000,
                  sold_volume_allocated: 40000,
                  gross_revenue: 220000,
                  allocated_buy_cost: 160000,
                  allocated_buy_fees: 4800,
                  attributable_sell_fees: 7920,
                  realized_profit_ttc: 47280,
                  roi_percent_ttc: 28.69,
                  coverage_status: 'COMPLETE',
                  coverage_percent: 100,
                  transaction_count: 1,
                },
              ],
            },
          }),
        } as Response);
      }
      if (pathname === '/api/roi/allocations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            allocations: [],
          }),
        } as Response);
      }
      if (pathname === '/api/roi/unsold-inventory') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            inventory: [],
          }),
        } as Response);
      }
      if (pathname === '/api/hubs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            hubs: [
              {
                id: 'hub-jita',
                name: 'Jita 4-4',
                system_name: 'Jita',
                is_system_default: true,
                created_at: new Date().toISOString(),
              },
            ],
          }),
        } as Response);
      }
      if (pathname === '/api/hubs/mappings') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            mappings: [],
          }),
        } as Response);
      }
      if (pathname === '/api/capital/summary') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            asOf: Date.now(),
            characterCount: 1,
            characterIds: [2119876543],
            monetary: {
              liquidWalletBalanceIsk: 50000000,
              marketBuyEscrowIsk: 15000000,
              inventoryCostValueIsk: 20000000,
              netRealCapitalIsk: 85000000,
              notionalMarketAskValueIsk: 80000000,
              unreconciledStockUnitsCount: 0,
              unreconciledStockEstimatedValueStatus: 'KNOWN',
            },
            physicalSummary: {
              totalItemsTracked: 1,
              distinctTypes: 1,
              distinctLocations: 1,
              totalUnits: 1000,
              committedSellOrderUnits: 400,
              freeHubStockUnits: 600,
              remoteDormantStockUnits: 0,
              inTransitStockUnits: 0,
              unreconciledCostUnits: 0,
            },
            dormantSummary: {
              dormantItemsCount: 0,
              dormantTotalUnits: 0,
              dormantCostValueIsk: 0,
              dormantLocationsCount: 0,
            },
          }),
        } as Response);
      }
      if (pathname === '/api/capital/breakdown') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            summary: {
              asOf: Date.now(),
              characterCount: 1,
              characterIds: [2119876543],
              monetary: {
                liquidWalletBalanceIsk: 50000000,
                marketBuyEscrowIsk: 15000000,
                inventoryCostValueIsk: 20000000,
                netRealCapitalIsk: 85000000,
                notionalMarketAskValueIsk: 80000000,
                unreconciledStockUnitsCount: 0,
                unreconciledStockEstimatedValueStatus: 'KNOWN',
              },
              physicalSummary: {
                totalItemsTracked: 1,
                distinctTypes: 1,
                distinctLocations: 1,
                totalUnits: 1000,
                committedSellOrderUnits: 400,
                freeHubStockUnits: 600,
                remoteDormantStockUnits: 0,
                inTransitStockUnits: 0,
                unreconciledCostUnits: 0,
              },
              dormantSummary: {
                dormantItemsCount: 0,
                dormantTotalUnits: 0,
                dormantCostValueIsk: 0,
                dormantLocationsCount: 0,
              },
            },
            positions: [
              {
                id: '2119876543:34:60003760:station',
                characterId: 2119876543,
                typeId: 34,
                typeName: 'Tritanium',
                locationId: 60003760,
                locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
                locationType: 'station',
                locationFlag: 'Hangar',
                hubId: 'hub-jita',
                hubName: 'Jita 4-4',
                isConfiguredHub: true,
                totalPhysicalQuantity: 1000,
                committedSellOrderQuantity: 400,
                freeHubStockQuantity: 600,
                remoteDormantStockQuantity: 0,
                inTransitQuantity: 0,
                primaryClassification: 'FREE_HUB_STOCK',
                daysInactive: 0,
                isDormant: false,
                unitCostIsk: 5.5,
                costBasisStatus: 'KNOWN',
                totalCostBasisIsk: 5500,
                activeSellOrdersCount: 1,
                sellOrderNotionalValueIsk: 2200,
                decompositionProof: {
                  totalPhysical: 1000,
                  committedSell: 400,
                  freeHub: 600,
                  remoteDormant: 0,
                  inTransit: 0,
                  isSumExact: true,
                },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 50,
            totalPages: 1,
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/Captain Trader/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Vue d'Ensemble/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Grand Livre/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Ordres & Marché/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Réapprovisionnement/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Hubs & ROI TTC/i).length).toBeGreaterThanOrEqual(1);
    });

    // Check Overview view content
    expect(screen.getByText(/Chiffre d'Affaires Brut/i)).toBeInTheDocument();
    expect(screen.getByText(/Bénéfice Réalisé \(TTC\)/i)).toBeInTheDocument();

    // Open preferences modal
    const prefBtn = screen.getByTitle(/Préférences d'affichage/i);
    await act(async () => {
      fireEvent.click(prefBtn);
    });
    expect(screen.getByText(/Préférences Utilisateur & Affichage/i)).toBeInTheDocument();

    const savePrefBtn = screen.getByText(/Enregistrer les Préférences/i);
    await act(async () => {
      fireEvent.click(savePrefBtn);
    });

    // Switch to Grand Livre Tab
    const ledgerTabBtn = screen.getAllByText(/Grand Livre/i)[0];
    await act(async () => {
      fireEvent.click(ledgerTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Toutes$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Ventes$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Achats$/i })).toBeInTheDocument();
      expect(screen.getByTitle(/Exporter les transactions filtrées en CSV/i)).toBeInTheDocument();
    });

    // Switch to Orders Tab
    const ordersTabBtn = screen.getAllByText(/Ordres & Marché/i)[0];
    await act(async () => {
      fireEvent.click(ordersTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Ordres Actifs en Marché/i)).toBeInTheDocument();
      expect(screen.getByText(/Progression Volume/i)).toBeInTheDocument();
      expect(screen.getAllByText(/PARTIEL/i).length).toBeGreaterThanOrEqual(1);
    });

    // Switch to Restock Tab
    const restockTabBtn = screen.getAllByText(/Réapprovisionnement/i)[0];
    await act(async () => {
      fireEvent.click(restockTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Listes de Réapprovisionnement Locales/i)).toBeInTheDocument();
      expect(screen.getByText(/Générer suggestions/i)).toBeInTheDocument();
      expect(screen.getByText(/Ajouter un article/i)).toBeInTheDocument();
    });

    // Switch to Hubs & ROI TTC Tab
    const roiTabBtn = screen.getAllByText(/Hubs & ROI TTC/i)[0];
    await act(async () => {
      fireEvent.click(roiTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Rentabilité Réelle TTC & Hubs Commerciaux/i)).toBeInTheDocument();
      expect(screen.getByText(/Rapprochement Automatique \(FIFO\)/i)).toBeInTheDocument();
    });

    // Switch to Capital & Stocks Tab
    const capitalTabBtn = screen.getAllByText(/Capital & Stocks/i)[0];
    await act(async () => {
      fireEvent.click(capitalTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Exporter Positions CSV/i)).toBeInTheDocument();
      expect(screen.getByText(/Total Unités Physiques/i)).toBeInTheDocument();
      expect(screen.getByText(/Trésorerie \+ Stocks/i)).toBeInTheDocument();
    });
  });
});
