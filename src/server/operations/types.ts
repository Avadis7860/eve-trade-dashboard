/**
 * Domain types and contracts for Operations: Restock and Prioritized Logistics Transfers (Phase 11)
 */

export type OperationalStatus =
  | 'SUGGESTED'
  | 'PLANNED'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'DISMISSED';

export interface TransferSuggestion {
  id: string; // `${characterId}:${typeId}:${sourceLocationId}:${targetLocationId}`
  characterId: number;
  typeId: number;
  typeName: string;
  quantity: number;
  unitVolumeM3: number;
  totalVolumeM3: number;
  sourceLocationId: number;
  sourceLocationName: string;
  sourceHubId?: string;
  sourceHubName?: string;
  targetLocationId: number;
  targetLocationName: string;
  targetHubId?: string;
  targetHubName?: string;
  estimatedUnitValueIsk: number;
  estimatedTotalValueIsk: number;
  status: OperationalStatus;
  reason: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RestockPurchaseSuggestion {
  id: string; // `${characterId}:${typeId}:${sellLocationId}`
  characterId: number;
  typeId: number;
  typeName: string;
  targetBuyHubId: number;
  targetBuyHubName: string;
  sellLocationId: number;
  sellLocationName: string;
  sellHubId?: string;
  sellHubName?: string;
  dailyVelocity: number; // V_jour
  velocityWindowDays: number; // e.g. 90
  horizonDays: number; // H_jours
  safetyStock: number; // S_securite
  targetQuantity: number; // Q_cible
  existingHubStock: number;
  existingSellOrders: number;
  existingBuyEscrow: number;
  existingQuantity: number; // Q_existant
  netNeedQuantity: number; // Q_besoin
  transferredQuantity: number; // Q_transfert
  purchaseQuantity: number; // Q_achat
  unitVolumeM3: number;
  totalVolumeM3: number;
  estimatedBuyUnitPrice: number;
  estimatedTotalCostIsk: number;
  status: OperationalStatus;
  justification: string;
  linkedOrderId?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OperationsPlanOptions {
  characterId?: number;
  characterIds?: number[];
  horizonDays?: number; // default 14
  velocityWindowDays?: number; // default 90 (14, 30, 60, 90, etc.)
  safetyStockDays?: number; // default 0
  targetBuyHubId?: number; // default 60003760 (Jita 4-4)
  now?: Date;
}

export interface CargoCapacityBenchmark {
  vesselClass: string;
  name: string;
  capacityM3: number;
  tripsNeeded: number;
}

export interface OperationsSummary {
  asOf: string;
  horizonDays: number;
  velocityWindowDays: number;
  totalTransfersCount: number;
  totalTransferQuantity: number;
  totalTransferVolumeM3: number;
  totalTransferValueIsk: number;
  totalPurchasesCount: number;
  totalPurchaseQuantity: number;
  totalPurchaseVolumeM3: number;
  totalPurchaseCostIsk: number;
  itemsCoveredByTransfer: number;
  itemsRequiringPurchase: number;
  transferVesselBenchmarks: CargoCapacityBenchmark[];
  purchaseVesselBenchmarks: CargoCapacityBenchmark[];
}

export interface OperationsPlanResponse {
  summary: OperationsSummary;
  transfers: TransferSuggestion[];
  purchases: RestockPurchaseSuggestion[];
}
