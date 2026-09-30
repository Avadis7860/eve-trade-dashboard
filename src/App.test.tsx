import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App.tsx';

describe('App Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders unauthenticated state with SSO login button and Phase 04 badge', async () => {
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
    expect(screen.getByText(/Phase 04 — Cycle des Ordres & Réapprovisionnement/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/Se connecter avec EVE Online \(SSO\)/i)).toBeInTheDocument();
    });
  });

  it('renders authenticated character profile, orders lifecycle, and restock planning', async () => {
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

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/Captain Trader/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Grand Livre/i)).toBeInTheDocument();
      expect(screen.getByText(/Ordres & Cycle de Vie/i)).toBeInTheDocument();
      expect(screen.getByText(/Réapprovisionnement/i)).toBeInTheDocument();
    });

    // Switch to Orders Tab
    const ordersTabBtn = screen.getByText(/Ordres & Cycle de Vie/i);
    await act(async () => {
      fireEvent.click(ordersTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Ordres Actifs en Marché/i)).toBeInTheDocument();
      expect(screen.getByText(/Progression Volume/i)).toBeInTheDocument();
      expect(screen.getAllByText(/PARTIEL/i).length).toBeGreaterThanOrEqual(1);
    });

    // Switch to Restock Tab
    const restockTabBtn = screen.getByText(/Réapprovisionnement/i);
    await act(async () => {
      fireEvent.click(restockTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Listes de Réapprovisionnement Locales/i)).toBeInTheDocument();
      expect(screen.getByText(/Générer suggestions/i)).toBeInTheDocument();
      expect(screen.getByText(/Ajouter un article/i)).toBeInTheDocument();
    });

    // Click generate suggestions
    const genBtn = screen.getByText(/Générer suggestions/i);
    await act(async () => {
      fireEvent.click(genBtn);
    });

    // Open and close Add Modal
    const addBtn = screen.getByText(/Ajouter un article/i);
    await act(async () => {
      fireEvent.click(addBtn);
    });

    expect(screen.getByText(/Ajouter un Article à Réapprovisionner/i)).toBeInTheDocument();
    const cancelBtn = screen.getByText(/Annuler/i);
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
  });
});
