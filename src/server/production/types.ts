/**
 * Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur)
 * Modèles de domaine, contrats de lignée (lineage) et types d'arbres de décomposition des coûts.
 */

import type { FormulaProof } from '../roi/types.ts';

export type ProductionCostBasisStatus = 'KNOWN' | 'PARTIAL' | 'UNKNOWN';

export type ProductionProvenance =
  | 'MANUFACTURED'
  | 'PLANETARY_TRANSFORMED'
  | 'FARMED'
  | 'PURCHASED'
  | 'OPENING';

/**
 * Détail d'un lot d'intrant individuel consommé par une étape de fabrication.
 */
export interface BomInputSourceLot {
  lotId: string;
  sourceType: 'TRANSACTION' | 'OPENING_BALANCE' | 'MANUFACTURED' | 'PLANETARY_TRANSFORMED' | 'FARMED';
  sourceId: number | string;
  characterId: number;
  quantityTaken: number;
  unitCostIsk: number | null; // null si UNKNOWN
  totalCostIsk: number | null;
  costBasisStatus: ProductionCostBasisStatus;
  lineage?: ProductionLineage; // Récursion multi-niveaux pour sous-composants ou PI
}

/**
 * Allocation d'un composant de la nomenclature (BOM) d'un job.
 */
export interface BomInputAllocation {
  typeId: number;
  typeName: string;
  quantityRequired: number; // Quantité totale requise par le job (runs * qty_per_run)
  quantityAllocated: number; // Quantité couverte par les lots d'intrants
  quantityMissing: number; // Quantité non couverte
  unitCostIsk: number | null; // Coût moyen pondéré des intrants consommés
  totalCostIsk: number | null; // Somme des coûts des lots consommés
  costBasisStatus: ProductionCostBasisStatus;
  sourceLots: BomInputSourceLot[];
}

/**
 * Généalogie et traçabilité unitaire complète d'un lot fabriqué (Lineage).
 */
export interface ProductionLineage {
  lineageId: string;
  jobId?: number; // Job d'industrie source
  planetId?: number; // Planète source (si PI)
  pinId?: number; // Pin source (si PI)
  characterId: number;
  activityId?: number;
  activityName?: string;
  outputTypeId: number;
  outputTypeName: string;
  outputQuantity: number;
  unitCostIsk: number | null;
  totalCostIsk: number | null;
  installationCostIsk: number; // Frais de pose d'industrie (ou d'installation)
  customsTaxIsk: number; // Taxes douanières POCO
  inputsCostIsk: number | null; // Somme des intrants
  costBasisStatus: ProductionCostBasisStatus;
  inputAllocations: BomInputAllocation[];
  depth: number; // Profondeur généalogique (0 = brut, 1 = P1/minéraux, 2 = P2/composants, 3 = P3/coque T1, 4 = P4/coque T2)
  createdAt: string; // ISO 8601
}

/**
 * Enregistrement persisté en base de données liant un lot produit fini à sa structure de coût.
 */
export interface ProductionCostAllocation {
  id: string;
  characterId: number;
  jobId?: number;
  outputLotId: string;
  outputTypeId: number;
  outputTypeName: string;
  outputQuantity: number;
  unitCostIsk: number | null;
  totalCostIsk: number | null;
  installationCostIsk: number;
  customsTaxIsk: number;
  inputsCostIsk: number | null;
  costBasisStatus: ProductionCostBasisStatus;
  provenance: 'MANUFACTURED' | 'PLANETARY_TRANSFORMED';
  lineage: ProductionLineage;
  allocatedAt: string;
  version: number;
}

/**
 * Nœud d'arbre de décomposition hiérarchique pour la visualisation UI (Product 360).
 */
export interface CostBreakdownNode {
  typeId: number;
  typeName: string;
  level: number;
  quantityRequired: number;
  unitCostIsk: number | null;
  totalCostIsk: number | null;
  costBasisStatus: ProductionCostBasisStatus;
  provenance: ProductionProvenance | 'UNKNOWN';
  sourceDescription: string;
  children?: CostBreakdownNode[];
}

/**
 * Synthèse de l'arbre multi-niveaux d'un article pour Product 360 et audit de coût.
 */
export interface MultiTierCostBreakdown {
  targetTypeId: number;
  targetTypeName: string;
  quantity: number;
  unitCostIsk: number | null;
  totalCostIsk: number | null;
  costBasisStatus: ProductionCostBasisStatus;
  materialsTotalIsk: number | null;
  installationTotalIsk: number;
  customsTotalIsk: number;
  nodes: CostBreakdownNode[];
  proof: FormulaProof;
}

export interface ProductionPropagationOptions {
  characterId?: number;
  characterIds?: number[];
  typeId?: number;
  forceRecalculate?: boolean;
}
