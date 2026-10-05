#!/usr/bin/env tsx
import { defaultFinancialRecoveryManager, type FinancialRecoveryOptions } from '../src/server/ledger/recovery.ts';
import { StorageManager } from '../src/server/storage/database.ts';

function formatIsk(value: number): string {
  const parts = Number(value || 0).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${parts.join('.')} ISK`;
}

function formatDelta(delta: number, isCurrency = true): string {
  const formatted = isCurrency ? formatIsk(Math.abs(delta)) : String(Math.abs(delta));
  if (delta > 0) return `+${formatted}`;
  if (delta < 0) return `-${formatted}`;
  return isCurrency ? '0.00 ISK' : '0';
}

function printUsage(): void {
  console.log(`
Usage: npm run db:recalculate-financials [options]

Options:
  --dry-run                 Simulate recovery and recalculation without modifying database (default)
  --write, --commit         Apply and persist recalculated state to database
  --backup-dir <path>       Custom directory for pre-recovery SHA-256 backup (default: ./.data/backups)
  --format <text|json>      Output format: formatted text summary (default) or raw JSON
  --strict-isolation        Enforce strict character isolation for inventory consumption
  --help, -h                Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const isWrite = args.includes('--write') || args.includes('--commit');
  const isDryRun = args.includes('--dry-run') || !isWrite;
  const isJson = args.includes('--format') && args[args.indexOf('--format') + 1] === 'json';
  const strictIsolation = args.includes('--strict-isolation');

  let backupDir: string | undefined;
  if (args.includes('--backup-dir')) {
    backupDir = args[args.indexOf('--backup-dir') + 1];
  }

  // Ensure database is initialized
  StorageManager.getInstance();

  const options: FinancialRecoveryOptions = {
    dryRun: isDryRun,
    backupDir,
    strictCharacterIsolation: strictIsolation,
  };

  try {
    const report = await defaultFinancialRecoveryManager.runRecovery(options);

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    }

    console.log('\n' + '='.repeat(80));
    console.log('  EVE TRADE DASHBOARD — FINANCIAL RECOVERY & HISTORICAL RECONCILIATION');
    console.log('='.repeat(80));
    console.log(`Execution Mode  : ${report.dryRun ? '🔍 DRY-RUN (Simulation - no data written)' : '💾 WRITE / COMMIT (Changes persisted)'}`);
    console.log(`Timestamp       : ${report.timestamp}`);
    console.log(`Pre-Recov SHA256: ${report.preRecoverySha256}`);
    if (report.backupFilePath) {
      console.log(`Backup File     : ${report.backupFilePath} (${report.backupSha256})`);
    }
    if (report.postRecoverySha256) {
      console.log(`Post-Recov SHA  : ${report.postRecoverySha256}`);
    }

    console.log('\n--- 1. ÉTAT DU GRAND LIVRE & JALONS FISCAUX ---');
    console.log(`Transactions    : ${report.metrics.before.transactionsCount} -> ${report.metrics.after.transactionsCount} (${formatDelta(report.metrics.deltas.deltaJournalEntriesCount, false)} net)`);
    console.log(`Journal Entries : ${report.metrics.before.journalEntriesCount} -> ${report.metrics.after.journalEntriesCount} (Doublons corpo purgés: ${report.details.journalDeduplication.removedDuplicatesCount})`);
    console.log(`Total Taxes     : ${formatIsk(report.metrics.before.totalTaxesIsk)} -> ${formatIsk(report.metrics.after.totalTaxesIsk)} (Delta: ${formatDelta(report.metrics.deltas.deltaTaxesIsk)})`);
    console.log(`Total Broker Fee: ${formatIsk(report.metrics.before.totalBrokerFeesIsk)} -> ${formatIsk(report.metrics.after.totalBrokerFeesIsk)} (Delta: ${formatDelta(report.metrics.deltas.deltaBrokerFeesIsk)})`);
    console.log(`Unallocated Fees: ${formatIsk(report.metrics.before.unallocatedBrokerFeesIsk)} -> ${formatIsk(report.metrics.after.unallocatedBrokerFeesIsk)}`);
    console.log(`Total Net Sales : ${formatIsk(report.metrics.before.totalNetSalesIsk)} -> ${formatIsk(report.metrics.after.totalNetSalesIsk)} (Delta: ${formatDelta(report.metrics.deltas.deltaNetSalesIsk)})`);

    console.log('\n--- 2. ALLOCATIONS COÛTS FIFO & RENTABILITÉ TTC ---');
    console.log(`Allocations     : ${report.metrics.before.allocationsCount} -> ${report.metrics.after.allocationsCount} (${report.metrics.after.autoAllocationsCount} FIFO auto, ${report.metrics.after.manualAllocationsCount} manuelles)`);
    console.log(`Quantité Allouée: ${report.metrics.before.totalQuantityReconciled} -> ${report.metrics.after.totalQuantityReconciled} (Delta: ${formatDelta(report.metrics.deltas.deltaQuantityReconciled, false)})`);
    console.log(`Ventes Couvertes: ${report.metrics.after.fullyMatchedSalesCount} intégrales, ${report.metrics.after.partiallyMatchedSalesCount} partielles, ${report.metrics.after.unmatchedSalesCount} orphelines`);
    console.log(`Bénéfice Réalisé: ${formatIsk(report.metrics.before.totalRealizedProfitIsk)} -> ${formatIsk(report.metrics.after.totalRealizedProfitIsk)} (Delta: ${formatDelta(report.metrics.deltas.deltaRealizedProfitIsk)})`);

    console.log('\n--- 3. CONTRÔLE D\'INTÉGRITÉ DES ALLOCATIONS MANUELLES ---');
    console.log(`Lots Manuels    : ${report.manualAllocationsIntegrity.preservedCount} / ${report.manualAllocationsIntegrity.expectedCount} préservés à 100%`);
    console.log(`Statut Intégrité: ${report.manualAllocationsIntegrity.intact ? '✅ STRICTEMENT CONFORME' : '❌ ANOMALIE DÉTECTÉE'}`);

    console.log('\n' + '='.repeat(80));
    console.log(`  RÉSULTAT : ${report.success ? '✅ SUCCÈS — Réconciliation terminée et qualifiée' : '❌ ÉCHEC — Incohérences détectées'}`);
    console.log('='.repeat(80) + '\n');

    process.exit(report.success ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ Erreur fatale lors de la réconciliation financière : ${(err as Error).message}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
