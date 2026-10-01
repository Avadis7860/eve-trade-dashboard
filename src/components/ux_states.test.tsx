import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LedgerView } from './LedgerView.tsx';
import { OrdersView } from './OrdersView.tsx';
import { HubsRoiView } from './HubsRoiView.tsx';
import { CapitalView } from './CapitalView.tsx';
import { PreferencesModal } from './PreferencesModal.tsx';
import { Product360Modal } from './Product360Modal.tsx';
import type { CharacterTransaction } from '../App.tsx';

describe('Level 4: Frontend Component States (docs/UX_STATES.md Compliance)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const sampleTx: CharacterTransaction = {
    id: '1001:1',
    characterId: 1001,
    transactionId: 1,
    date: '2026-09-30T12:00:00Z',
    typeId: 34,
    typeName: 'Tritanium',
    quantity: 10000,
    unitPrice: 5.5,
    totalValue: 55000,
    isBuy: true,
    isPersonal: true,
    journalRefId: 101,
    locationId: 60003760,
    locationName: 'Jita IV - Moon 4',
    clientId: 2001,
    clientName: 'Supplier Corp',
    source: 'esi',
    observedAt: Date.now(),
  };

  describe('1. LedgerView UX States', () => {
    it('renders LOADING state correctly with skeleton/spinners', () => {
      render(
        <LedgerView
          transactions={[]}
          summary={null}
          loading={true}
          page={1}
          totalPages={1}
          totalCount={0}
          filterType="ALL"
          searchQuery=""
          selectedLocation="ALL"
          distinctLocations={[]}
          iskDisplayMode="compact"
          onFilterTypeChange={vi.fn()}
          onSearchChange={vi.fn()}
          onLocationChange={vi.fn()}
          onPageChange={vi.fn()}
          onInspectTransaction={vi.fn()}
        />
      );

      expect(screen.getByText(/Chargement des transactions/i)).toBeInTheDocument();
    });

    it('renders EMPTY state when no transactions exist', () => {
      render(
        <LedgerView
          transactions={[]}
          summary={{
            characterId: 1001,
            asOf: Date.now(),
            totalTransactionsCount: 0,
            sellTransactionsCount: 0,
            buyTransactionsCount: 0,
            totalSellVolume: 0,
            totalBuyVolume: 0,
            totalGrossSalesIsk: 0,
            totalBuySpendIsk: 0,
            distinctItemsCount: 0,
            distinctLocationsCount: 0,
            completeness: 'COMPLETE',
          }}
          loading={false}
          page={1}
          totalPages={1}
          totalCount={0}
          filterType="ALL"
          searchQuery=""
          selectedLocation="ALL"
          distinctLocations={[]}
          iskDisplayMode="compact"
          onFilterTypeChange={vi.fn()}
          onSearchChange={vi.fn()}
          onLocationChange={vi.fn()}
          onPageChange={vi.fn()}
          onInspectTransaction={vi.fn()}
        />
      );

      expect(screen.getByText(/Aucune transaction trouvée/i)).toBeInTheDocument();
    });

    it('renders SUCCESS state with transactions list, badges and interaction triggers', () => {
      const inspectSpy = vi.fn();
      const p360Spy = vi.fn();

      render(
        <LedgerView
          transactions={[sampleTx]}
          summary={{
            characterId: 1001,
            asOf: Date.now(),
            totalTransactionsCount: 1,
            sellTransactionsCount: 0,
            buyTransactionsCount: 1,
            totalSellVolume: 0,
            totalBuyVolume: 10000,
            totalGrossSalesIsk: 0,
            totalBuySpendIsk: 55000,
            distinctItemsCount: 1,
            distinctLocationsCount: 1,
            completeness: 'COMPLETE',
          }}
          loading={false}
          page={1}
          totalPages={1}
          totalCount={1}
          filterType="ALL"
          searchQuery=""
          selectedLocation="ALL"
          distinctLocations={[{ id: 60003760, name: 'Jita IV - Moon 4', count: 1 }]}
          iskDisplayMode="compact"
          onFilterTypeChange={vi.fn()}
          onSearchChange={vi.fn()}
          onLocationChange={vi.fn()}
          onPageChange={vi.fn()}
          onInspectTransaction={inspectSpy}
          onOpenProduct360={p360Spy}
        />
      );

      expect(screen.getAllByText('Tritanium').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('ACHAT')).toBeInTheDocument();

      // Trigger Product 360 link
      const p360Btn = screen.getByTitle(/Ouvrir la fiche Product 360/i);
      fireEvent.click(p360Btn);
      expect(p360Spy).toHaveBeenCalledWith(34);
    });
  });

  describe('2. OrdersView UX States', () => {
    it('renders EMPTY state when no orders exist', () => {
      render(
        <OrdersView
          orders={[]}
          orderSummary={{
            characterId: 1001,
            asOf: Date.now(),
            totalOrdersTracked: 0,
            activeOrdersCount: 0,
            partiallyFilledCount: 0,
            completedCount: 0,
            cancelledCount: 0,
            expiredCount: 0,
            disappearedCount: 0,
            totalActiveIskValue: 0,
            totalActiveEscrowIsk: 0,
          }}
          orderStateFilter="ALL"
          ordersSearch=""
          ordersPage={1}
          ordersTotalPages={1}
          ordersTotalCount={0}
          iskDisplayMode="compact"
          onOrderStateFilterChange={vi.fn()}
          onOrdersSearchChange={vi.fn()}
          onOrdersPageChange={vi.fn()}
          onSelectOrder={vi.fn()}
          onQuickAddRestock={vi.fn()}
          onOpenProduct360={vi.fn()}
        />
      );

      expect(screen.getByText(/Aucun ordre de marché ne correspond/i)).toBeInTheDocument();
    });

    it('renders SUCCESS state with active orders and fill progress', () => {
      render(
        <OrdersView
          orders={[
            {
              id: '1001:101',
              characterId: 1001,
              orderId: 101,
              typeId: 34,
              typeName: 'Tritanium',
              regionId: 10000002,
              locationId: 60003760,
              locationName: 'Jita IV - Moon 4',
              isBuyOrder: false,
              price: 6.0,
              volumeTotal: 10000,
              volumeRemain: 4000,
              volumeFilled: 6000,
              issued: '2026-09-30T10:00:00Z',
              duration: 90,
              expiresAt: '2026-12-29T10:00:00Z',
              state: 'PARTIALLY_FILLED',
              stateJustification: 'Partiel',
              firstObservedAt: Date.now(),
              lastObservedAt: Date.now(),
              isActiveInCurrentSnapshot: true,
            },
          ]}
          orderSummary={{
            characterId: 1001,
            asOf: Date.now(),
            totalOrdersTracked: 1,
            activeOrdersCount: 1,
            partiallyFilledCount: 1,
            completedCount: 0,
            cancelledCount: 0,
            expiredCount: 0,
            disappearedCount: 0,
            totalActiveIskValue: 24000,
            totalActiveEscrowIsk: 0,
          }}
          orderStateFilter="ALL"
          ordersSearch=""
          ordersPage={1}
          ordersTotalPages={1}
          ordersTotalCount={1}
          iskDisplayMode="compact"
          onOrderStateFilterChange={vi.fn()}
          onOrdersSearchChange={vi.fn()}
          onOrdersPageChange={vi.fn()}
          onSelectOrder={vi.fn()}
          onQuickAddRestock={vi.fn()}
          onOpenProduct360={vi.fn()}
        />
      );

      expect(screen.getAllByText('Tritanium').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/PARTIEL/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/restants/i)).toBeInTheDocument();
    });
  });

  describe('3. HubsRoiView & FIFO Reconciliation UX States', () => {
    it('renders HubsRoiView with complete status and FIFO trigger button', () => {
      const reconcileSpy = vi.fn();

      render(
        <HubsRoiView
          roiSummary={{
            as_of: new Date().toISOString(),
            period_label: '90 jours',
            total_sales_volume: 1000,
            allocated_sales_volume: 1000,
            unallocated_sales_volume: 0,
            gross_revenue_isk: 10000,
            allocated_buy_cost_isk: 6000,
            allocated_buy_fees_isk: 180,
            attributable_sell_fees_isk: 360,
            total_allocated_investment_ttc: 6180,
            realized_profit_ttc_isk: 3460,
            roi_percent_ttc: 55.98,
            tied_up_capital_isk: 5000,
            unsold_items_count: 0,
            coverage_status: 'COMPLETE',
            coverage_percent: 100,
            hub_pairs: [],
          }}
          allocations={[]}
          unsoldInventory={[]}
          hubsList={[
            {
              id: 'hub-jita',
              name: 'Jita IV-4',
              system_name: 'Jita',
              is_system_default: true,
              created_at: new Date().toISOString(),
            },
          ]}
          hubsMappings={[]}
          iskDisplayMode="compact"
          isReconciling={false}
          reconcileMessage={null}
          onAutoReconcile={reconcileSpy}
          onOpenAddAllocationModal={vi.fn()}
          onDeleteAllocation={vi.fn()}
          onOpenAddHubModal={vi.fn()}
          onDeleteHub={vi.fn()}
          onOpenAddMappingModal={vi.fn()}
          onDeleteMapping={vi.fn()}
          onAutoDiscoverHubs={vi.fn()}
          onOpenProduct360={vi.fn()}
        />
      );

      expect(screen.getByText(/Rentabilité Réelle TTC & Hubs Commerciaux/i)).toBeInTheDocument();
      const fifoBtn = screen.getByText(/Rapprochement Automatique \(FIFO\)/i);
      fireEvent.click(fifoBtn);
      expect(reconcileSpy).toHaveBeenCalled();
    });
  });

  describe('4. CapitalView & Decomposition Statuses', () => {
    it('renders Capital decomposition positions with distinct stock classifications', async () => {
      global.fetch = vi.fn((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/capital/breakdown')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              summary: {
                asOf: Date.now(),
                characterCount: 1,
                characterIds: [1001],
                monetary: {
                  liquidWalletBalanceIsk: 1000000,
                  marketBuyEscrowIsk: 200000,
                  inventoryCostValueIsk: 500000,
                  netRealCapitalIsk: 1700000,
                  notionalMarketAskValueIsk: 1800000,
                  unreconciledStockUnitsCount: 0,
                  unreconciledStockEstimatedValueStatus: 'KNOWN',
                },
                physicalSummary: {
                  totalItemsTracked: 1,
                  distinctTypes: 1,
                  distinctLocations: 1,
                  totalUnits: 1000,
                  committedSellOrderUnits: 300,
                  freeHubStockUnits: 700,
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
                  id: '1001:34:60003760:station',
                  characterId: 1001,
                  typeId: 34,
                  typeName: 'Tritanium Mineral',
                  locationId: 60003760,
                  locationName: 'Jita IV - Moon 4',
                  locationType: 'station',
                  locationFlag: 'Hangar',
                  hubId: 'hub-jita',
                  hubName: 'Jita 4-4',
                  isConfiguredHub: true,
                  totalPhysicalQuantity: 1000,
                  committedSellOrderQuantity: 300,
                  freeHubStockQuantity: 700,
                  remoteDormantStockQuantity: 0,
                  inTransitQuantity: 0,
                  primaryClassification: 'FREE_HUB_STOCK',
                  daysInactive: 5,
                  isDormant: false,
                  unitCostIsk: 5.0,
                  costBasisStatus: 'KNOWN',
                  totalCostBasisIsk: 5000,
                  activeSellOrdersCount: 1,
                  sellOrderNotionalValueIsk: 1800,
                  decompositionProof: {
                    totalPhysical: 1000,
                    committedSell: 300,
                    freeHub: 700,
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
        return Promise.reject(new Error('Unknown url'));
      });

      render(
        <CapitalView
          formatIsk={(val) => `${Number(val || 0).toLocaleString()} ISK`}
          activeCharacterId={1001}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Trésorerie \+ Stocks/i)).toBeInTheDocument();
        expect(screen.getAllByText('Tritanium Mineral').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/Libre Hub/i).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('5. Product360Modal & PreferencesModal Interactions', () => {
    it('renders PreferencesModal and emits updated settings', () => {
      const saveSpy = vi.fn();
      const closeSpy = vi.fn();

      render(
        <PreferencesModal
          preferences={{
            defaultLandingTab: 'overview',
            iskDisplayMode: 'compact',
            hideCompletedOrders: false,
            tablePageSize: 25,
          }}
          onSave={saveSpy}
          onClose={closeSpy}
        />
      );

      expect(screen.getByText(/Préférences Utilisateur & Affichage/i)).toBeInTheDocument();
      const saveBtn = screen.getByText(/Enregistrer les Préférences/i);
      fireEvent.click(saveBtn);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('renders Product360Modal with KPIs, charts, and close action', async () => {
      global.fetch = vi.fn((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/analytics/product/34')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              type_id: 34,
              type_name: 'Tritanium Mineral',
              image_url: 'https://images.evetech.net/types/34/icon?size=64',
              as_of: new Date().toISOString(),
              timeframe: '90d',
              kpis: {
                gross_revenue_isk: 500000,
                cogs_allocated_isk: 300000,
                allocated_sell_fees_isk: 20000,
                realized_profit_ttc_isk: 180000,
                roi_percent_ttc: 60.0,
                units_sold: 100000,
                units_bought: 120000,
                sales_transactions_count: 5,
                buy_transactions_count: 2,
                velocity_daily: 1111.11,
                velocity_observation_days: 90,
                average_holding_days: 12.5,
                coverage_ratio_holding_days: 1.0,
                yield_per_capital_day_percent: 4.8,
                committed_capital_isk: 60000,
                stock_summary: {
                  total_quantity: 20000,
                  committed_sell_order_qty: 10000,
                  free_hub_stock_qty: 10000,
                  remote_dormant_stock_qty: 0,
                  in_transit_stock_qty: 0,
                  unreconciled_stock_qty: 0,
                  total_cost_isk: 60000,
                  total_notional_sell_isk: 120000,
                },
              },
              locations_breakdown: [],
              open_orders: [],
              transactions_history: [],
              timeseries: {
                timeframe: '90d',
                group_by: 'day',
                type_id: 34,
                type_name: 'Tritanium Mineral',
                start_date: new Date().toISOString(),
                end_date: new Date().toISOString(),
                observed_days: 90,
                as_of: new Date().toISOString(),
                freshness_status: 'FRESH',
                data_points: [],
                lot_age_distribution: [],
                hub_flows: [],
                uncertainty_notes: [],
              },
            }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown'));
      });

      const closeSpy = vi.fn();

      render(
        <Product360Modal
          typeId={34}
          preferences={{
            defaultLandingTab: 'overview',
            iskDisplayMode: 'compact',
            hideCompletedOrders: false,
            tablePageSize: 25,
          }}
          onClose={closeSpy}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('PRODUCT 360')).toBeInTheDocument();
        expect(screen.getAllByText('Tritanium Mineral').length).toBeGreaterThanOrEqual(1);
      });

      const closeBtn = screen.getByTitle(/Fermer la fiche Product 360/i);
      fireEvent.click(closeBtn);
      expect(closeSpy).toHaveBeenCalled();
    });
  });
});
