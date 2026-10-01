/**
 * RFC 4180 compliant CSV Export Utility for EVE Trade Dashboard
 */

import { CharacterTransaction, CharacterOrderSnapshot, RestockItem, ExplicitCostAllocation } from '../App';

export function escapeCsvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function transactionsToCsv(transactions: CharacterTransaction[]): string {
  const headers = [
    'TransactionID',
    'DateUTC',
    'Type',
    'TypeID',
    'TypeName',
    'Quantity',
    'UnitPriceISK',
    'TotalGrossValueISK',
    'TaxISK',
    'BrokerFeeISK',
    'NetValueISK',
    'LocationID',
    'LocationName',
    'ClientName',
    'IsPersonal'
  ];

  const rows = transactions.map((t) => [
    escapeCsvField(t.transactionId),
    escapeCsvField(t.date),
    escapeCsvField(t.isBuy ? 'ACHAT' : 'VENTE'),
    escapeCsvField(t.typeId),
    escapeCsvField(t.typeName || ''),
    escapeCsvField(t.quantity),
    escapeCsvField(t.unitPrice),
    escapeCsvField(t.totalValue),
    escapeCsvField(t.tax ?? 0),
    escapeCsvField(t.brokerFee ?? 0),
    escapeCsvField(t.netValue ?? t.totalValue),
    escapeCsvField(t.locationId),
    escapeCsvField(t.locationName || ''),
    escapeCsvField(t.clientName || ''),
    escapeCsvField(t.isPersonal ? 'Oui' : 'Non')
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function ordersToCsv(orders: CharacterOrderSnapshot[]): string {
  const headers = [
    'OrderID',
    'IssuedUTC',
    'ExpiresAtUTC',
    'Type',
    'TypeID',
    'TypeName',
    'State',
    'PriceISK',
    'VolumeTotal',
    'VolumeRemain',
    'VolumeFilled',
    'EscrowISK',
    'LocationID',
    'LocationName',
    'StateJustification'
  ];

  const rows = orders.map((o) => [
    escapeCsvField(o.orderId),
    escapeCsvField(o.issued),
    escapeCsvField(o.expiresAt),
    escapeCsvField(o.isBuyOrder ? 'ACHAT' : 'VENTE'),
    escapeCsvField(o.typeId),
    escapeCsvField(o.typeName || ''),
    escapeCsvField(o.state),
    escapeCsvField(o.price),
    escapeCsvField(o.volumeTotal),
    escapeCsvField(o.volumeRemain),
    escapeCsvField(o.volumeFilled),
    escapeCsvField(o.escrow ?? 0),
    escapeCsvField(o.locationId),
    escapeCsvField(o.locationName || ''),
    escapeCsvField(o.stateJustification)
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function restockToCsv(items: RestockItem[]): string {
  const headers = [
    'ItemID',
    'TypeID',
    'TypeName',
    'Status',
    'TargetQuantity',
    'SuggestedQuantity',
    'TargetBuyHubID',
    'TargetBuyHubName',
    'SellHubID',
    'SellHubName',
    'Justification',
    'Notes'
  ];

  const rows = items.map((i) => [
    escapeCsvField(i.id),
    escapeCsvField(i.typeId),
    escapeCsvField(i.typeName),
    escapeCsvField(i.status),
    escapeCsvField(i.targetQuantity),
    escapeCsvField(i.suggestedQuantity),
    escapeCsvField(i.targetBuyHubId),
    escapeCsvField(i.targetBuyHubName),
    escapeCsvField(i.sellHubId),
    escapeCsvField(i.sellHubName),
    escapeCsvField(i.justification),
    escapeCsvField(i.notes || '')
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function transfersToCsv(transfers: Array<{
  id: string;
  typeId: number;
  typeName: string;
  quantity: number;
  unitVolumeM3: number;
  totalVolumeM3: number;
  sourceLocationName: string;
  sourceHubName?: string;
  targetLocationName: string;
  targetHubName?: string;
  estimatedUnitValueIsk: number;
  estimatedTotalValueIsk: number;
  status: string;
  reason: string;
  notes?: string;
}>): string {
  const headers = [
    'TransferID',
    'TypeID',
    'TypeName',
    'Quantity',
    'UnitVolumeM3',
    'TotalVolumeM3',
    'SourceLocation',
    'SourceHub',
    'TargetLocation',
    'TargetHub',
    'EstimatedUnitValueISK',
    'EstimatedTotalValueISK',
    'Status',
    'Reason',
    'Notes'
  ];

  const rows = transfers.map((t) => [
    escapeCsvField(t.id),
    escapeCsvField(t.typeId),
    escapeCsvField(t.typeName),
    escapeCsvField(t.quantity),
    escapeCsvField(t.unitVolumeM3),
    escapeCsvField(t.totalVolumeM3),
    escapeCsvField(t.sourceLocationName),
    escapeCsvField(t.sourceHubName || ''),
    escapeCsvField(t.targetLocationName),
    escapeCsvField(t.targetHubName || ''),
    escapeCsvField(t.estimatedUnitValueIsk),
    escapeCsvField(t.estimatedTotalValueIsk),
    escapeCsvField(t.status),
    escapeCsvField(t.reason),
    escapeCsvField(t.notes || '')
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function restockPurchasesToCsv(purchases: Array<{
  id: string;
  typeId: number;
  typeName: string;
  targetBuyHubName: string;
  sellLocationName: string;
  sellHubName?: string;
  dailyVelocity: number;
  horizonDays: number;
  targetQuantity: number;
  existingQuantity: number;
  netNeedQuantity: number;
  transferredQuantity: number;
  purchaseQuantity: number;
  unitVolumeM3: number;
  totalVolumeM3: number;
  estimatedBuyUnitPrice: number;
  estimatedTotalCostIsk: number;
  status: string;
  justification: string;
  notes?: string;
}>): string {
  const headers = [
    'PurchaseID',
    'TypeID',
    'TypeName',
    'TargetBuyHub',
    'SellLocation',
    'SellHub',
    'DailyVelocity',
    'HorizonDays',
    'TargetQuantity',
    'ExistingQuantity',
    'NetNeedQuantity',
    'TransferredQuantity',
    'PurchaseQuantity',
    'UnitVolumeM3',
    'TotalVolumeM3',
    'EstimatedUnitPriceISK',
    'EstimatedTotalCostISK',
    'Status',
    'Justification',
    'Notes'
  ];

  const rows = purchases.map((p) => [
    escapeCsvField(p.id),
    escapeCsvField(p.typeId),
    escapeCsvField(p.typeName),
    escapeCsvField(p.targetBuyHubName),
    escapeCsvField(p.sellLocationName),
    escapeCsvField(p.sellHubName || ''),
    escapeCsvField(p.dailyVelocity),
    escapeCsvField(p.horizonDays),
    escapeCsvField(p.targetQuantity),
    escapeCsvField(p.existingQuantity),
    escapeCsvField(p.netNeedQuantity),
    escapeCsvField(p.transferredQuantity),
    escapeCsvField(p.purchaseQuantity),
    escapeCsvField(p.unitVolumeM3),
    escapeCsvField(p.totalVolumeM3),
    escapeCsvField(p.estimatedBuyUnitPrice),
    escapeCsvField(p.estimatedTotalCostIsk),
    escapeCsvField(p.status),
    escapeCsvField(p.justification),
    escapeCsvField(p.notes || '')
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function allocationsToCsv(allocations: ExplicitCostAllocation[]): string {
  const headers = [
    'AllocationID',
    'SellTxID',
    'BuyTxID',
    'TypeID',
    'TypeName',
    'QuantityAllocated',
    'UnitBuyPriceISK',
    'AllocatedBuyCostISK',
    'AllocatedBuyFeesISK',
    'AllocatedSellFeesISK',
    'BuyHubName',
    'SellHubName',
    'CreatedAt',
    'Notes'
  ];

  const rows = allocations.map((a) => [
    escapeCsvField(a.id),
    escapeCsvField(a.sell_transaction_id),
    escapeCsvField(a.buy_transaction_id),
    escapeCsvField(a.type_id),
    escapeCsvField(a.type_name),
    escapeCsvField(a.quantity_allocated),
    escapeCsvField(a.unit_buy_price),
    escapeCsvField(a.allocated_buy_cost),
    escapeCsvField(a.allocated_buy_fees),
    escapeCsvField(a.allocated_sell_fees),
    escapeCsvField(a.buy_hub_name),
    escapeCsvField(a.sell_hub_name),
    escapeCsvField(a.created_at),
    escapeCsvField(a.notes || '')
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function positionsToCsv(positions: Array<{
  typeId: number;
  typeName: string;
  locationName: string;
  hubName: string;
  isConfiguredHub: boolean;
  primaryClassification: string;
  totalPhysicalQuantity: number;
  committedSellOrderQuantity: number;
  freeHubStockQuantity: number;
  remoteDormantStockQuantity: number;
  inTransitQuantity: number;
  daysInactive: number;
  isDormant: boolean;
  unitCostIsk: number | null;
  totalCostBasisIsk: number | null;
  sellOrderNotionalValueIsk: number;
  decompositionProof: { isSumExact: boolean };
}>): string {
  const headers = [
    'TypeID',
    'TypeName',
    'LocationName',
    'HubName',
    'IsConfiguredHub',
    'Classification',
    'TotalPhysicalQuantity',
    'CommittedSellOrderQuantity',
    'FreeHubStockQuantity',
    'RemoteDormantStockQuantity',
    'InTransitQuantity',
    'DaysInactive',
    'IsDormant',
    'UnitCostISK',
    'TotalCostBasisISK',
    'SellOrderNotionalValueISK',
    'ArithmeticProofValid',
  ];

  const rows = positions.map((p) => [
    escapeCsvField(p.typeId),
    escapeCsvField(p.typeName),
    escapeCsvField(p.locationName),
    escapeCsvField(p.hubName),
    escapeCsvField(p.isConfiguredHub ? 'Oui' : 'Non'),
    escapeCsvField(p.primaryClassification),
    escapeCsvField(p.totalPhysicalQuantity),
    escapeCsvField(p.committedSellOrderQuantity),
    escapeCsvField(p.freeHubStockQuantity),
    escapeCsvField(p.remoteDormantStockQuantity),
    escapeCsvField(p.inTransitQuantity),
    escapeCsvField(p.daysInactive),
    escapeCsvField(p.isDormant ? 'Oui' : 'Non'),
    escapeCsvField(p.unitCostIsk !== null ? p.unitCostIsk : 'UNKNOWN'),
    escapeCsvField(p.totalCostBasisIsk !== null ? p.totalCostBasisIsk : 'UNKNOWN'),
    escapeCsvField(p.sellOrderNotionalValueIsk),
    escapeCsvField(p.decompositionProof.isSumExact ? 'Oui' : 'Non'),
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function timeSeriesToCsv(dataPoints: Array<{
  period_label: string;
  period_start: string;
  period_end: string;
  units_sold: number;
  units_bought: number;
  gross_revenue_isk: number;
  buy_spend_isk: number;
  realized_profit_ttc_isk: number;
  fees_and_taxes_isk: number;
  cumulative_profit_ttc_isk: number;
  cumulative_gross_revenue_isk: number;
  sales_count: number;
  buys_count: number;
}>): string {
  const headers = [
    'Periode',
    'DateDebut',
    'DateFin',
    'UnitesVendues',
    'UnitesAchetees',
    'CABrutISK',
    'DepensesAchatsISK',
    'ProfitRealiseTTC_ISK',
    'FraisEtTaxesISK',
    'ProfitCumuleTTC_ISK',
    'CACumuleISK',
    'NombreVentes',
    'NombreAchats',
  ];

  const rows = dataPoints.map((dp) => [
    escapeCsvField(dp.period_label),
    escapeCsvField(dp.period_start),
    escapeCsvField(dp.period_end),
    escapeCsvField(dp.units_sold),
    escapeCsvField(dp.units_bought),
    escapeCsvField(dp.gross_revenue_isk),
    escapeCsvField(dp.buy_spend_isk),
    escapeCsvField(dp.realized_profit_ttc_isk),
    escapeCsvField(dp.fees_and_taxes_isk),
    escapeCsvField(dp.cumulative_profit_ttc_isk),
    escapeCsvField(dp.cumulative_gross_revenue_isk),
    escapeCsvField(dp.sales_count),
    escapeCsvField(dp.buys_count),
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

export function triggerCsvDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
