import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import type { IAssetsRepository } from '../assets/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import { RoiRepository, roiRepository as defaultRoiRepository } from '../roi/repository.ts';
import { HubsService, hubsService as defaultHubsService } from '../hubs/service.ts';
import { UniverseService, defaultUniverseService } from '../universe/service.ts';
import { CapitalService, capitalService as defaultCapitalService } from '../capital/service.ts';
import { VolumeRegistry, defaultVolumeRegistry } from './volumeRegistry.ts';
import { roundIsk } from '../roi/calculator.ts';
import type {
  OperationalStatus,
  TransferSuggestion,
  RestockPurchaseSuggestion,
  OperationsPlanOptions,
  OperationsPlanResponse,
  OperationsSummary,
} from './types.ts';

const DEFAULT_BUY_HUB_ID = 60003760; // Jita IV - Moon 4 - Caldari Navy Assembly Plant

const IN_TRANSIT_FLAGS = new Set([
  'cargohold',
  'fleethangar',
  'specializedfuelbay',
  'specializedorehold',
  'specializedgashold',
  'specializedmineralhold',
  'specializedshiphold',
  'specializedammohold',
  'deliveries',
  'secondarystorage',
  'structureactive',
]);

function isAssetInTransit(locationType: string, locationFlag: string): boolean {
  const normFlag = (locationFlag || '').toLowerCase();
  const normType = (locationType || '').toLowerCase();
  if (IN_TRANSIT_FLAGS.has(normFlag)) return true;
  if (normType === 'solar_system') return true;
  return false;
}

export class OperationsService {
  private operationalStatuses: Map<string, OperationalStatus> = new Map();
  private operationalNotes: Map<string, string> = new Map();

  constructor(
    private ordersRepo: IOrdersRepository = defaultOrdersRepository,
    private assetsRepo: IAssetsRepository = defaultAssetsRepository,
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    _roiRepo: RoiRepository = defaultRoiRepository,
    private hubsService: HubsService = defaultHubsService,
    private universeService: UniverseService = defaultUniverseService,
    _capitalService: CapitalService = defaultCapitalService,
    private volumeRegistry: VolumeRegistry = defaultVolumeRegistry
  ) {}

  /**
   * Sets custom status for a transfer or purchase suggestion
   */
  public setItemStatus(id: string, status: OperationalStatus, notes?: string): void {
    this.operationalStatuses.set(id, status);
    if (notes !== undefined) {
      this.operationalNotes.set(id, notes);
    }
  }

  /**
   * Builds the comprehensive operations plan distinguishing prioritized transfers from restock purchases
   */
  public async getOperationsPlan(options: OperationsPlanOptions = {}): Promise<OperationsPlanResponse> {
    const horizonDays = options.horizonDays && options.horizonDays > 0 ? options.horizonDays : 14;
    const velocityWindowDays = options.velocityWindowDays && options.velocityWindowDays > 0 ? options.velocityWindowDays : 90;
    const safetyStockDays = options.safetyStockDays && options.safetyStockDays >= 0 ? options.safetyStockDays : 0;
    const targetBuyHubId = options.targetBuyHubId || DEFAULT_BUY_HUB_ID;
    const now = options.now || new Date();

    const characterId = options.characterId;
    const characterIds = options.characterIds && options.characterIds.length > 0
      ? options.characterIds
      : characterId !== undefined
      ? [characterId]
      : [];

    const effectiveCharIds = characterIds.length > 0
      ? characterIds
      : characterId !== undefined
      ? [characterId]
      : [1];

    const targetBuyHubName = this.universeService.getNameSync(targetBuyHubId, 'Station');

    // 1. Gather all assets across characters
    const allAssets = this.assetsRepo.getAllAssets(undefined, effectiveCharIds);

    // Group assets by characterId + typeId + locationId
    // And exclude items in transit (cargoholds, etc.)
    const assetsByCharTypeLoc = new Map<string, number>();
    const allAssetsByTypeLoc = new Map<string, number>();

    for (const asset of allAssets) {
      if (!isAssetInTransit(asset.locationType, asset.locationFlag)) {
        const charKey = `${asset.characterId}:${asset.typeId}:${asset.locationId}`;
        assetsByCharTypeLoc.set(charKey, (assetsByCharTypeLoc.get(charKey) || 0) + asset.quantity);

        const typeLocKey = `${asset.typeId}:${asset.locationId}`;
        allAssetsByTypeLoc.set(typeLocKey, (allAssetsByTypeLoc.get(typeLocKey) || 0) + asset.quantity);
      }
    }

    // 2. Gather all orders across characters
    const activeSellOrdersByCharTypeLoc = new Map<string, number>();
    const activeBuyOrdersByCharTypeLoc = new Map<string, number>();
    const candidateTypesAndLocations = new Map<string, {
      characterId: number;
      typeId: number;
      typeName?: string;
      locationId: number;
      locationName?: string;
      lastOrderVolume?: number;
      linkedOrderId?: number;
      triggerReason: string;
    }>();

    for (const charId of effectiveCharIds) {
      const orders = this.ordersRepo.getOrdersForCharacter(charId);
      for (const order of orders) {
        const charKey = `${charId}:${order.typeId}:${order.locationId}`;
        if (order.isActiveInCurrentSnapshot) {
          if (order.isBuyOrder) {
            activeBuyOrdersByCharTypeLoc.set(charKey, (activeBuyOrdersByCharTypeLoc.get(charKey) || 0) + order.volumeRemain);
          } else {
            activeSellOrdersByCharTypeLoc.set(charKey, (activeSellOrdersByCharTypeLoc.get(charKey) || 0) + order.volumeRemain);
          }
        }

        // Detect replenishment triggers
        if (!order.isBuyOrder) {
          const isCompleted = order.state === 'COMPLETED_CONFIRMED';
          const isDisappeared = order.state === 'DISAPPEARED_UNCONFIRMED';
          const isExpired = order.state === 'EXPIRED_CONFIRMED';
          const isLowStock = order.state === 'PARTIALLY_FILLED' && (order.volumeRemain <= Math.max(1, order.volumeTotal * 0.3));

          if (isCompleted || isDisappeared || isExpired || isLowStock) {
            const candidateKey = `${charId}:${order.typeId}:${order.locationId}`;
            let triggerReason = `Ordre de vente #${order.orderId} complété`;
            if (isLowStock) triggerReason = `Stock faible (${order.volumeRemain}/${order.volumeTotal} restants)`;
            else if (isDisappeared) triggerReason = `Ordre #${order.orderId} disparu du marché`;
            else if (isExpired) triggerReason = `Ordre #${order.orderId} expiré`;

            if (!candidateTypesAndLocations.has(candidateKey)) {
              candidateTypesAndLocations.set(candidateKey, {
                characterId: charId,
                typeId: order.typeId,
                typeName: order.typeName,
                locationId: order.locationId,
                locationName: order.locationName,
                lastOrderVolume: order.volumeTotal,
                linkedOrderId: order.orderId,
                triggerReason,
              });
            }
          }
        }
      }
    }

    // 3. Include manually added restock items from repository
    for (const charId of effectiveCharIds) {
      const restockItems = this.ordersRepo.getRestockItems(charId);
      for (const item of restockItems) {
        const candidateKey = `${charId}:${item.typeId}:${item.sellHubId}`;
        if (!candidateTypesAndLocations.has(candidateKey)) {
          candidateTypesAndLocations.set(candidateKey, {
            characterId: charId,
            typeId: item.typeId,
            typeName: item.typeName,
            locationId: Number(item.sellHubId),
            locationName: item.sellHubName,
            lastOrderVolume: item.targetQuantity || item.suggestedQuantity,
            linkedOrderId: item.linkedOrderId,
            triggerReason: item.justification || 'Article ajouté manuellement',
          });
        }
      }
    }

    // 4. Gather transactions for daily velocity calculation
    const allTransactions = this.ledgerRepo.getAllTransactions(undefined, effectiveCharIds);
    const windowStartDate = new Date(now.getTime() - velocityWindowDays * 24 * 3600 * 1000);

    // Sales volume map: `${characterId}:${typeId}:${locationId}` -> unitsSold
    // Also typeId -> unitsSold across all locations for fallback
    const salesInWindow = new Map<string, number>();
    const salesByCharTypeInWindow = new Map<string, number>();
    const latestBuyMap = new Map<number, { unitPrice: number; dateMs: number }>();

    for (const tx of allTransactions) {
      const txDate = new Date(tx.date);
      const txDateMs = txDate.getTime();
      if (tx.isBuy && !isNaN(txDateMs)) {
        const currentLatest = latestBuyMap.get(tx.typeId);
        if (!currentLatest || txDateMs > currentLatest.dateMs) {
          latestBuyMap.set(tx.typeId, { unitPrice: tx.unitPrice, dateMs: txDateMs });
        }
      } else if (txDate >= windowStartDate && txDate <= now) {
        const locKey = `${tx.characterId}:${tx.typeId}:${tx.locationId}`;
        salesInWindow.set(locKey, (salesInWindow.get(locKey) || 0) + tx.quantity);

        const charTypeKey = `${tx.characterId}:${tx.typeId}`;
        salesByCharTypeInWindow.set(charTypeKey, (salesByCharTypeInWindow.get(charTypeKey) || 0) + tx.quantity);
      }
    }

    // 5. Track allocated remote stock so one remote lot isn't double-allocated across candidates
    const availableRemoteStockByTypeLoc = new Map<string, number>();
    for (const [typeLocKey, totalQty] of allAssetsByTypeLoc.entries()) {
      const [typeIdStr, locIdStr] = typeLocKey.split(':');
      const typeId = Number(typeIdStr);
      const locId = Number(locIdStr);

      // Deduct active sell orders at that location
      let activeSellsAtLoc = 0;
      for (const charId of effectiveCharIds) {
        const charKey = `${charId}:${typeId}:${locId}`;
        activeSellsAtLoc += activeSellOrdersByCharTypeLoc.get(charKey) || 0;
      }

      const freeRemoteStock = Math.max(0, totalQty - activeSellsAtLoc);
      availableRemoteStockByTypeLoc.set(typeLocKey, freeRemoteStock);
    }

    const transferSuggestions: TransferSuggestion[] = [];
    const restockPurchases: RestockPurchaseSuggestion[] = [];

    // 6. Process each candidate for replenishment
    for (const candidate of candidateTypesAndLocations.values()) {
      const {
        characterId: charId,
        typeId,
        locationId: sellLocId,
        linkedOrderId,
      } = candidate;

      const typeName = candidate.typeName || this.universeService.getNameSync(typeId, 'Type');
      const sellLocationName = candidate.locationName || this.universeService.getNameSync(sellLocId, 'Station');
      const sellHub = this.hubsService.resolveLocationToHub(sellLocId, sellLocationName);

      const charKey = `${charId}:${typeId}:${sellLocId}`;

      // Calculate Daily Velocity V_jour
      const soldInLocation = salesInWindow.get(charKey) || 0;
      const soldInCharType = salesByCharTypeInWindow.get(`${charId}:${typeId}`) || 0;
      const effectiveSales = soldInLocation > 0 ? soldInLocation : soldInCharType;

      const dailyVelocity = effectiveSales > 0 ? Number((effectiveSales / velocityWindowDays).toFixed(2)) : 0;
      const safetyStock = safetyStockDays > 0 && dailyVelocity > 0 ? Math.ceil(dailyVelocity * safetyStockDays) : 0;

      // Target quantity Q_cible
      let targetQuantity = 0;
      const hasVelocity = dailyVelocity > 0;

      if (hasVelocity) {
        targetQuantity = Math.ceil((dailyVelocity * horizonDays) + safetyStock);
      } else {
        targetQuantity = candidate.lastOrderVolume || 10;
      }

      // Existing local stock Q_existant
      const localTotalAssets = assetsByCharTypeLoc.get(charKey) || 0;
      const localActiveSells = activeSellOrdersByCharTypeLoc.get(charKey) || 0;
      const localFreeStock = Math.max(0, localTotalAssets - localActiveSells);
      const localActiveBuys = activeBuyOrdersByCharTypeLoc.get(charKey) || 0;

      const existingQuantity = localFreeStock + localActiveSells + localActiveBuys;

      // Net need Q_besoin
      const netNeedQuantity = Math.max(0, targetQuantity - existingQuantity);

      if (netNeedQuantity <= 0) {
        // Already sufficient stock
        continue;
      }

      // Prioritized Transfer vs Purchase Arbitrage
      let transferredQuantity = 0;
      const unitVolumeM3 = this.volumeRegistry.getItemVolumeM3(typeId, typeName);
      const estimatedUnitPrice = latestBuyMap.get(typeId)?.unitPrice || 10_000;

      // Scan other locations for free stock
      let remainingNeed = netNeedQuantity;

      for (const [typeLocKey, currentAvailable] of availableRemoteStockByTypeLoc.entries()) {
        if (remainingNeed <= 0) break;

        const [tIdStr, locIdStr] = typeLocKey.split(':');
        const remoteTypeId = Number(tIdStr);
        const remoteLocId = Number(locIdStr);

        // Must match type and be at a DIFFERENT location
        if (remoteTypeId === typeId && remoteLocId !== sellLocId && currentAvailable > 0) {
          const qtyToTransfer = Math.min(remainingNeed, currentAvailable);
          if (qtyToTransfer > 0) {
            transferredQuantity += qtyToTransfer;
            remainingNeed -= qtyToTransfer;
            availableRemoteStockByTypeLoc.set(typeLocKey, currentAvailable - qtyToTransfer);

            const sourceLocName = this.universeService.getNameSync(remoteLocId, 'Station');
            const sourceHub = this.hubsService.resolveLocationToHub(remoteLocId, sourceLocName);
            const transferId = `${charId}:${typeId}:${remoteLocId}:${sellLocId}`;
            const customStatus = this.operationalStatuses.get(transferId) || 'SUGGESTED';
            const customNotes = this.operationalNotes.get(transferId);

            transferSuggestions.push({
              id: transferId,
              characterId: charId,
              typeId,
              typeName,
              quantity: qtyToTransfer,
              unitVolumeM3,
              totalVolumeM3: Number((qtyToTransfer * unitVolumeM3).toFixed(2)),
              sourceLocationId: remoteLocId,
              sourceLocationName: sourceLocName,
              sourceHubId: sourceHub.hub_id,
              sourceHubName: sourceHub.hub_name,
              targetLocationId: sellLocId,
              targetLocationName: sellLocationName,
              targetHubId: sellHub.hub_id,
              targetHubName: sellHub.hub_name,
              estimatedUnitValueIsk: estimatedUnitPrice,
              estimatedTotalValueIsk: roundIsk(qtyToTransfer * estimatedUnitPrice),
              status: customStatus,
              reason: `Stock libre prioritaire identifié à ${sourceLocName} (${qtyToTransfer} u.)`,
              notes: customNotes,
              createdAt: now.getTime(),
              updatedAt: now.getTime(),
            });
          }
        }
      }

      // Residual purchase quantity Q_achat
      const purchaseQuantity = remainingNeed;

      if (purchaseQuantity > 0) {
        const purchaseId = `${charId}:${typeId}:${sellLocId}`;
        const customStatus = this.operationalStatuses.get(purchaseId) || 'SUGGESTED';
        const customNotes = this.operationalNotes.get(purchaseId);

        let justification = '';
        if (hasVelocity) {
          justification = `Besoin net: ${netNeedQuantity} u. [Cible: ${targetQuantity} (${dailyVelocity} u/j × ${horizonDays}j${safetyStock > 0 ? ` + ${safetyStock} séc.` : ''}) - Existant: ${existingQuantity}]${transferredQuantity > 0 ? ` - Transféré: ${transferredQuantity} u.` : ''} => Achat net: ${purchaseQuantity} u.`;
        } else {
          justification = `Vitesse historique non disponible — Besoin: ${netNeedQuantity} u. [Cible: ${targetQuantity} - Existant: ${existingQuantity}]${transferredQuantity > 0 ? ` - Transféré: ${transferredQuantity} u.` : ''} => Achat net: ${purchaseQuantity} u.`;
        }

        restockPurchases.push({
          id: purchaseId,
          characterId: charId,
          typeId,
          typeName,
          targetBuyHubId,
          targetBuyHubName,
          sellLocationId: sellLocId,
          sellLocationName,
          sellHubId: sellHub.hub_id,
          sellHubName: sellHub.hub_name,
          dailyVelocity,
          velocityWindowDays,
          horizonDays,
          safetyStock,
          targetQuantity,
          existingHubStock: localFreeStock,
          existingSellOrders: localActiveSells,
          existingBuyEscrow: localActiveBuys,
          existingQuantity,
          netNeedQuantity,
          transferredQuantity,
          purchaseQuantity,
          unitVolumeM3,
          totalVolumeM3: Number((purchaseQuantity * unitVolumeM3).toFixed(2)),
          estimatedBuyUnitPrice: estimatedUnitPrice,
          estimatedTotalCostIsk: roundIsk(purchaseQuantity * estimatedUnitPrice),
          status: customStatus,
          justification,
          linkedOrderId,
          notes: customNotes,
          createdAt: now.getTime(),
          updatedAt: now.getTime(),
        });
      }
    }

    // Sort transfers and purchases
    transferSuggestions.sort((a, b) => b.totalVolumeM3 - a.totalVolumeM3);
    restockPurchases.sort((a, b) => b.estimatedTotalCostIsk - a.estimatedTotalCostIsk);

    // Compute Summary & Vessel Benchmarks
    const totalTransferQuantity = transferSuggestions.reduce((acc, t) => acc + t.quantity, 0);
    const totalTransferVolumeM3 = Number(transferSuggestions.reduce((acc, t) => acc + t.totalVolumeM3, 0).toFixed(2));
    const totalTransferValueIsk = roundIsk(transferSuggestions.reduce((acc, t) => acc + t.estimatedTotalValueIsk, 0));

    const totalPurchaseQuantity = restockPurchases.reduce((acc, p) => acc + p.purchaseQuantity, 0);
    const totalPurchaseVolumeM3 = Number(restockPurchases.reduce((acc, p) => acc + p.totalVolumeM3, 0).toFixed(2));
    const totalPurchaseCostIsk = roundIsk(restockPurchases.reduce((acc, p) => acc + p.estimatedTotalCostIsk, 0));

    const summary: OperationsSummary = {
      asOf: now.toISOString(),
      horizonDays,
      velocityWindowDays,
      totalTransfersCount: transferSuggestions.length,
      totalTransferQuantity,
      totalTransferVolumeM3,
      totalTransferValueIsk,
      totalPurchasesCount: restockPurchases.length,
      totalPurchaseQuantity,
      totalPurchaseVolumeM3,
      totalPurchaseCostIsk,
      itemsCoveredByTransfer: transferSuggestions.length,
      itemsRequiringPurchase: restockPurchases.length,
      transferVesselBenchmarks: this.volumeRegistry.calculateVesselBenchmarks(totalTransferVolumeM3),
      purchaseVesselBenchmarks: this.volumeRegistry.calculateVesselBenchmarks(totalPurchaseVolumeM3),
    };

    return {
      summary,
      transfers: transferSuggestions,
      purchases: restockPurchases,
    };
  }
}

export const defaultOperationsService = new OperationsService();
export const operationsService = defaultOperationsService;
