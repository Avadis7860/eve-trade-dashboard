// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../../server.ts';
import { MiningRepository, defaultMiningRepository } from './repository.ts';
import { MiningService, defaultMiningService, STANDARD_MINING_OPPORTUNITY_PRICES } from './service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { RawEsiMiningEntry } from '../esi/types.ts';

describe('Phase P02 — Registre Minier & Coûts d\'Opportunité Farm / Mining', () => {
  let app: Express;
  let sessionToken: string;
  let miningRepo: MiningRepository;
  let miningService: MiningService;

  const testCharId = 91001;
  const secondaryCharId = 91002;
  const foreignCharId = 99999;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createApp();
  });

  beforeEach(() => {
    miningRepo = defaultMiningRepository;
    miningRepo.clearAll();
    miningService = defaultMiningService;

    const session = defaultSessionStore.createSession({
      characterId: testCharId,
      characterName: 'Mining Fleet Commander',
      scopes: ['publicData', 'esi-industry.read_character_mining.v1'],
      accessToken: 'access-mining-91001',
      refreshToken: 'refresh-mining-91001',
      expiresAt: Date.now() + 3600000,
    });
    session.characters = {
      [testCharId]: {
        characterId: testCharId,
        characterName: 'Mining Fleet Commander',
        scopes: ['publicData', 'esi-industry.read_character_mining.v1'],
        accessToken: 'access-mining-91001',
        refreshToken: 'refresh-mining-91001',
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      },
      [secondaryCharId]: {
        characterId: secondaryCharId,
        characterName: 'Mining Barge Pilot',
        scopes: ['publicData', 'esi-industry.read_character_mining.v1'],
        accessToken: 'access-mining-91002',
        refreshToken: 'refresh-mining-91002',
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      },
    };
    sessionToken = session.sessionId;
  });

  describe('1. Ingestion Idempotente & Dépôt Dédié (mining_ledger)', () => {
    const rawBatch: RawEsiMiningEntry[] = [
      {
        date: '2026-10-10',
        solar_system_id: 30000142, // Jita
        type_id: 17459, // Veldspar
        quantity: 50000,
      },
      {
        date: '2026-10-10',
        solar_system_id: 30000142, // Jita
        type_id: 1228, // Scordite
        quantity: 25000,
      },
      {
        date: '2026-10-09',
        solar_system_id: 30002187, // Amamake
        type_id: 17459, // Veldspar
        quantity: 100000,
      },
    ];

    it('TEST-P02-01: Ingestion idempotente sans doublons pour tous les personnages de la flotte', async () => {
      // Première passe
      const res1 = await miningService.ingestRawMiningEntries(testCharId, rawBatch);
      expect(res1.inserted).toBe(3);
      expect(res1.updated).toBe(0);

      const entriesFirst = miningRepo.getAllMiningEntries(testCharId);
      expect(entriesFirst).toHaveLength(3);

      // Deuxième passe avec les mêmes données
      const res2 = await miningService.ingestRawMiningEntries(testCharId, rawBatch);
      expect(res2.inserted).toBe(0);
      expect(res2.updated).toBe(3);

      const entriesSecond = miningRepo.getAllMiningEntries(testCharId);
      expect(entriesSecond).toHaveLength(3);

      // Ingestion pour le deuxième personnage de la flotte avec des clés distinctes
      const resSecondary = await miningService.ingestRawMiningEntries(secondaryCharId, rawBatch);
      expect(resSecondary.inserted).toBe(3);

      const totalFleetEntries = miningRepo.getMiningEntriesForCharacters([testCharId, secondaryCharId]);
      expect(totalFleetEntries).toHaveLength(6);
    });
  });

  describe('2. Règle d\'Or Comptable & Invariance UNKNOWN (Pas de minerai à 0.00 ISK)', () => {
    it('TEST-P02-02: Aucun lot farmé n\'est injecté avec un coût d\'opportunité indéfini ou coercé à 0.00 ISK sans statut UNKNOWN', async () => {
      const unknownOreTypeId = 99999999; // Type d'item imaginaire inconnu
      const rawUnknown: RawEsiMiningEntry[] = [
        {
          date: '2026-10-11',
          solar_system_id: 30000142,
          type_id: unknownOreTypeId,
          quantity: 12000,
        },
      ];

      await miningService.ingestRawMiningEntries(testCharId, rawUnknown);
      const entries = miningRepo.getAllMiningEntries(testCharId);
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      // Invariance stricte : UNKNOWN ne vaut jamais zéro
      expect(entry.estimatedUnitValue).toBeNull();
      expect(entry.opportunityCostIsk).toBeNull();
      expect(entry.costBasisStatus).toBe('UNKNOWN');
      expect(entry.estimatedUnitValue).not.toBe(0);
      expect(entry.opportunityCostIsk).not.toBe(0);
    });

    it('TEST-P02-03: Double valorisation hermétique (Trésorerie 0.00 ISK vs Opportunité économique non nulle)', async () => {
      const veldsparTypeId = 17459; // Veldspar référencé dans STANDARD_MINING_OPPORTUNITY_PRICES (12.80 ISK)
      const quantity = 100000;
      const expectedUnitValue = STANDARD_MINING_OPPORTUNITY_PRICES[veldsparTypeId];

      await miningService.ingestRawMiningEntries(testCharId, [
        {
          date: '2026-10-11',
          solar_system_id: 30000142,
          type_id: veldsparTypeId,
          quantity,
        },
      ]);

      const entry = miningRepo.getAllMiningEntries(testCharId)[0];
      // Dimension 1 : Trésorerie décaissée nulle
      expect(entry.realizedCashCostIsk).toBe(0);
      expect(entry.provenance).toBe('FARMED');

      // Dimension 2 : Coût d'opportunité économique d'extraction
      expect(entry.estimatedUnitValue).toBe(expectedUnitValue);
      expect(entry.opportunityCostIsk).toBe(Number((quantity * expectedUnitValue).toFixed(4)));
      expect(entry.costBasisStatus).toBe('KNOWN');
    });
  });

  describe('3. Ségrégation Hermétique du Module & Non-Pollution de transactions', () => {
    it('TEST-P02-04: Le module mining/ fonctionne de manière autonome sans importer ni modifier la table transactions', async () => {
      const initialTxCount = defaultLedgerRepository.getAllTransactions(testCharId).length;

      await miningService.ingestRawMiningEntries(testCharId, [
        {
          date: '2026-10-11',
          solar_system_id: 30000142,
          type_id: 17459,
          quantity: 45000,
        },
      ]);

      const afterTxCount = defaultLedgerRepository.getAllTransactions(testCharId).length;
      expect(afterTxCount).toBe(initialTxCount);
      expect(miningRepo.getAllMiningEntries(testCharId)).toHaveLength(1);
    });
  });

  describe('4. Métriques de Synthèse & Décomposition Multi-Dimensionnelle', () => {
    it('TEST-P02-05: Calcule la synthèse avec qualification KNOWN, PARTIAL et UNKNOWN', async () => {
      const knownTypeId = 17459; // Veldspar
      const unknownTypeId = 88888888; // Inconnu

      await miningService.ingestRawMiningEntries(testCharId, [
        {
          date: '2026-10-10',
          solar_system_id: 30000142,
          type_id: knownTypeId,
          quantity: 50000,
        },
        {
          date: '2026-10-11',
          solar_system_id: 30000142,
          type_id: unknownTypeId,
          quantity: 10000,
        },
      ]);

      const summary = await miningService.getSummary([testCharId]);
      expect(summary.totalQuantity).toBe(60000);
      expect(summary.totalEntries).toBe(2);
      expect(summary.activeDaysCount).toBe(2);
      expect(summary.valuationStatus).toBe('PARTIAL');
      expect(summary.knownValueQuantity).toBe(50000);
      expect(summary.unknownValueQuantity).toBe(10000);
      expect(summary.totalOpportunityCostIsk).toBeGreaterThan(0);
      expect(summary.byType).toHaveLength(2);

      const knownTypeBreakdown = summary.byType.find((t) => t.typeId === knownTypeId);
      expect(knownTypeBreakdown?.valuationStatus).toBe('KNOWN');
      expect(knownTypeBreakdown?.opportunityCostIsk).toBeGreaterThan(0);

      const unknownTypeBreakdown = summary.byType.find((t) => t.typeId === unknownTypeId);
      expect(unknownTypeBreakdown?.valuationStatus).toBe('UNKNOWN');
      expect(unknownTypeBreakdown?.opportunityCostIsk).toBeNull();
      expect(unknownTypeBreakdown?.estimatedUnitValue).toBeNull();
    });

    it('TEST-P02-06: Calcule la double rentabilité (ROI Commercial Pur vs Marge de Trésorerie Brute de Farm)', () => {
      const typeId = 17459; // Veldspar à 12.80 ISK unitaire
      const quantity = 10000;
      const salePriceIsk = 180000; // Vente à 18.00 ISK unitaire
      const taxesIsk = 6480; // Taxe 3.6%

      const dual = miningService.calculateDualProfitability({
        typeId,
        quantity,
        salePriceIsk,
        taxesIsk,
      });

      // 1. ROI commercial pur
      const expectedOpportunityCost = 10000 * 12.8; // 128 000 ISK
      expect(dual.opportunityCostIsk).toBe(expectedOpportunityCost);
      const expectedCommercialProfit = 180000 - expectedOpportunityCost - 6480; // 45 520 ISK
      expect(dual.commercialProfitIsk).toBe(expectedCommercialProfit);
      const expectedRoiPercent = Number(((expectedCommercialProfit / expectedOpportunityCost) * 100).toFixed(2));
      expect(dual.commercialRoiPercent).toBe(expectedRoiPercent);

      // 2. Marge de trésorerie brute de farm
      expect(dual.realizedCashCostIsk).toBe(0);
      expect(dual.cashMarginIsk).toBe(180000 - 6480); // 173 520 ISK
      expect(dual.cashMarginPercent).toBe(100);
      expect(dual.valuationStatus).toBe('KNOWN');
    });

    it('TEST-P02-07: Surcharge personnalisée des prix de référence et recalculation', async () => {
      const typeId = 17459;
      await miningService.ingestRawMiningEntries(testCharId, [
        {
          date: '2026-10-10',
          solar_system_id: 30000142,
          type_id: typeId,
          quantity: 1000,
        },
      ]);

      // Valeur initiale standard
      let entry = miningRepo.getAllMiningEntries(testCharId)[0];
      expect(entry.estimatedUnitValue).toBe(STANDARD_MINING_OPPORTUNITY_PRICES[typeId]);

      // Surcharge par l'utilisateur
      miningService.setOpportunityPrice(typeId, 25.0, 'USER_OVERRIDE');
      const updatedCount = await miningService.recalculateValuations([testCharId]);
      expect(updatedCount).toBe(1);

      entry = miningRepo.getAllMiningEntries(testCharId)[0];
      expect(entry.estimatedUnitValue).toBe(25.0);
      expect(entry.opportunityCostIsk).toBe(25000);
    });
  });

  describe('5. Endpoints REST (/api/mining) & Contrôle d\'Accès Multi-Personnages', () => {
    beforeEach(async () => {
      await miningService.ingestRawMiningEntries(testCharId, [
        {
          date: '2026-10-10',
          solar_system_id: 30000142,
          type_id: 17459,
          quantity: 20000,
        },
      ]);
    });

    it('TEST-P02-08: GET /api/mining/ledger retourne les écritures avec session valide et refuse les non-autorisés', async () => {
      // Sans session -> 401
      const unauth = await request(app).get('/api/mining/ledger');
      expect(unauth.status).toBe(401);

      // Avec session valide
      const res = await request(app)
        .get('/api/mining/ledger')
        .set('Authorization', `Bearer ${sessionToken}`);
      expect(res.status).toBe(200);
      expect(res.body.entries).toBeDefined();

      // Tentative d'accès à un personnage étranger hors-session -> 403
      const forbidden = await request(app)
        .get(`/api/mining/ledger?character_id=${foreignCharId}`)
        .set('Authorization', `Bearer ${sessionToken}`);
      expect(forbidden.status).toBe(403);
    });

    it('TEST-P02-09: GET /api/mining/summary retourne la synthèse et les ventilations', async () => {
      const res = await request(app)
        .get('/api/mining/summary')
        .set('Authorization', `Bearer ${sessionToken}`);
      expect(res.status).toBe(200);
      expect(res.body.totalQuantity).toBe(20000);
      expect(res.body.valuationStatus).toBe('KNOWN');
      expect(Array.isArray(res.body.byType)).toBe(true);
    });

    it('TEST-P02-10: GET et POST /api/mining/opportunity-costs gèrent les prix de référence', async () => {
      // GET
      const getRes = await request(app)
        .get('/api/mining/opportunity-costs')
        .set('Authorization', `Bearer ${sessionToken}`);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);

      // POST
      const postRes = await request(app)
        .post('/api/mining/opportunity-costs')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          typeId: 17459,
          referencePrice: 20.5,
          source: 'USER_OVERRIDE',
        });
      expect(postRes.status).toBe(200);
      expect(postRes.body.success).toBe(true);
    });

    it('TEST-P02-11: GET /api/mining/dual-profitability calcule la rentabilité duale via HTTP', async () => {
      const res = await request(app)
        .get('/api/mining/dual-profitability?type_id=17459&quantity=10000&sale_price_isk=200000&taxes_isk=7200')
        .set('Authorization', `Bearer ${sessionToken}`);
      expect(res.status).toBe(200);
      expect(res.body.realizedCashCostIsk).toBe(0);
      expect(res.body.cashMarginIsk).toBe(192800);
      expect(res.body.opportunityCostIsk).toBeDefined();
      expect(res.body.commercialProfitIsk).toBeDefined();
      expect(res.body.commercialRoiPercent).toBeDefined();
    });
  });
});
