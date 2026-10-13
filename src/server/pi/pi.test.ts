// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { PiRepository } from './repository.ts';
import { PiService } from './service.ts';
import { createPiRouter } from './router.ts';
import { AuthService } from '../auth/service.ts';
import { SessionStore } from '../auth/sessionStore.ts';
import { CapitalService } from '../capital/service.ts';
import { InMemoryAssetsRepository } from '../assets/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { RoiRepository } from '../roi/repository.ts';
import { HubsRepository } from '../hubs/repository.ts';
import { HubsService } from '../hubs/service.ts';
import { WalletRepository } from '../ledger/walletRepository.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';
import type { RawEsiPlanet, RawEsiPlanetDetail, RawEsiCustomsOffice } from '../esi/types.ts';

describe('Phase P03 — Colonies Planétaires & Flux de Matières PI', () => {
  let piRepo: PiRepository;
  let piService: PiService;
  let ledgerRepo: InMemoryLedgerRepository;
  let sessionStore: SessionStore;
  let authService: AuthService;
  let app: express.Express;

  const CHAR_MAIN = 95001;
  const CHAR_ALT1 = 95002;
  const CHAR_UNAUTHORIZED = 99999;
  const TEST_PLANET_1 = 40010;
  const TEST_PLANET_2 = 40020;
  const TEST_SYSTEM = 30000142; // Jita solar system

  const samplePlanet1: RawEsiPlanet = {
    owner_id: CHAR_MAIN,
    planet_id: TEST_PLANET_1,
    planet_type: 'temperate',
    solar_system_id: TEST_SYSTEM,
    upgrade_level: 5,
    num_pins: 6,
    last_update: '2026-10-12T00:00:00Z',
  };

  const samplePlanet2: RawEsiPlanet = {
    owner_id: CHAR_ALT1,
    planet_id: TEST_PLANET_2,
    planet_type: 'barren',
    solar_system_id: TEST_SYSTEM,
    upgrade_level: 4,
    num_pins: 4,
    last_update: '2026-10-12T01:00:00Z',
  };

  const sampleDetailPlanet1: RawEsiPlanetDetail = {
    links: [
      { source_pin_id: 101, destination_pin_id: 102, link_level: 1 },
      { source_pin_id: 102, destination_pin_id: 103, link_level: 1 },
      { source_pin_id: 103, destination_pin_id: 104, link_level: 1 },
    ],
    pins: [
      // 1. Extractor ECU (Microorganisms -> P0 type 2073)
      {
        pin_id: 101,
        type_id: 2845, // Extractor Control Unit
        latitude: 0.1,
        longitude: 0.2,
        install_time: '2026-10-10T00:00:00Z',
        expiry_time: '2026-10-15T00:00:00Z',
        extractor_details: {
          cycle_time: 900, // 15 minutes = 4 cycles per hour
          qty_per_cycle: 1500, // 6,000 units/h
          product_type_id: 2073, // Microorganisms
          heads: [{ head_id: 1, latitude: 0.11, longitude: 0.21 }],
        },
      },
      // 2. Silo / Storage facility (holding P0 stock)
      {
        pin_id: 102,
        type_id: 2256, // Storage facility
        latitude: 0.15,
        longitude: 0.25,
        contents: [
          { type_id: 2073, amount: 25000 }, // 25,000 units Microorganisms (P0)
        ],
      },
      // 3. Basic Industry Facility (P0 -> P1 Bacteria 2393)
      {
        pin_id: 103,
        type_id: 2469, // Basic Industry Facility
        schematic_id: 65,
        latitude: 0.2,
        longitude: 0.3,
        contents: [
          { type_id: 2073, amount: 6000 }, // Input buffer
          { type_id: 2393, amount: 40 },   // Output buffer (P1 Bacteria)
        ],
      },
      // 4. Spaceport / Launchpad (holding finished P1 Bacteria)
      {
        pin_id: 104,
        type_id: 2543, // Launchpad / Spaceport
        latitude: 0.25,
        longitude: 0.35,
        contents: [
          { type_id: 2393, amount: 1200 }, // 1,200 units Bacteria (P1)
        ],
      },
      // 5. Command Center
      {
        pin_id: 105,
        type_id: 2254, // Temperate Command Center
        latitude: 0.0,
        longitude: 0.0,
      },
    ],
    routes: [
      // Extractor -> Silo
      {
        route_id: 1,
        source_pin_id: 101,
        destination_pin_id: 102,
        content_type_id: 2073,
        quantity: 6000,
      },
      // Silo -> Factory
      {
        route_id: 2,
        source_pin_id: 102,
        destination_pin_id: 103,
        content_type_id: 2073,
        quantity: 6000,
      },
      // Factory -> Spaceport
      {
        route_id: 3,
        source_pin_id: 103,
        destination_pin_id: 104,
        content_type_id: 2393,
        quantity: 40,
      },
    ],
  };

  const samplePOCO: RawEsiCustomsOffice = {
    office_id: 990001,
    solar_system_id: TEST_SYSTEM,
    corporation_tax_rate: 0.04, // 4%
    alliance_tax_rate: 0.02,
    allow_access_with_standings: true,
    allow_alliance_access: true,
    reinforce_exit_end: 18,
    reinforce_exit_start: 16,
  };

  beforeEach(async () => {
    piRepo = new PiRepository(null as unknown as IDatabaseAdapter);
    piRepo.clearAll();

    ledgerRepo = new InMemoryLedgerRepository(null);
    piService = new PiService(piRepo, undefined, ledgerRepo);

    sessionStore = new SessionStore(null as unknown as IDatabaseAdapter);
    await sessionStore.init();

    authService = new AuthService(undefined, sessionStore);

    // Initialiser une session valide pour la flotte (CHAR_MAIN et CHAR_ALT1)
    sessionStore.createSession({
      sessionId: 'test-session-pi',
      characterId: CHAR_MAIN,
      characterName: 'Fleet Trader Main',
      scopes: ['esi-planets.manage_planets.v1', 'esi-wallet.read_character_wallet.v1'],
      accessToken: 'acc_token_1',
      refreshToken: 'ref_token_1',
      expiresAt: Date.now() + 3600000,
    });
    sessionStore.addOrUpdateCharacter('test-session-pi', {
      characterId: CHAR_ALT1,
      characterName: 'Fleet PI Alt',
      scopes: ['esi-planets.manage_planets.v1'],
      accessToken: 'acc_token_2',
      refreshToken: 'ref_token_2',
      expiresAt: Date.now() + 3600000,
    }, false);

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/pi', createPiRouter(piService, authService));
  });

  describe('1. Ingestion, Modélisation et Persistance des Colonies & Pins', () => {
    it('TEST-P03-01: Ingestion idempotente de colonies et détails de pins dans PiRepository', async () => {
      const res = await piRepo.saveColonies(CHAR_MAIN, [samplePlanet1]);
      expect(res.inserted).toBe(1);

      await piRepo.saveColonyDetail(CHAR_MAIN, TEST_PLANET_1, sampleDetailPlanet1);

      const savedColonies = piRepo.getColonies(CHAR_MAIN);
      expect(savedColonies).toHaveLength(1);
      expect(savedColonies[0].planet_id).toBe(TEST_PLANET_1);

      const savedDetail = piRepo.getColonyDetail(CHAR_MAIN, TEST_PLANET_1);
      expect(savedDetail).not.toBeNull();
      expect(savedDetail?.pins).toHaveLength(5);
      expect(savedDetail?.routes).toHaveLength(3);
      expect(savedDetail?.links).toHaveLength(3);
    });

    it('TEST-P03-02: Supporte une flotte complète multi-personnages (11 personnages) sans collision de clés', async () => {
      // Simuler 11 personnages possédant chacun 6 colonies (66 colonies au total)
      const fleetCharacters = Array.from({ length: 11 }, (_, i) => 91000 + i);

      for (const charId of fleetCharacters) {
        const planets: RawEsiPlanet[] = Array.from({ length: 6 }, (_, pIdx) => ({
          owner_id: charId,
          planet_id: charId * 100 + pIdx,
          planet_type: 'temperate',
          solar_system_id: 30000000 + pIdx,
          upgrade_level: 5,
          num_pins: 6,
          last_update: '2026-10-12T00:00:00Z',
        }));
        await piRepo.saveColonies(charId, planets);
      }

      const allColonies = piRepo.getColonies();
      expect(allColonies).toHaveLength(66);

      // Isolation par personnage vérifiée
      const charColonies = piRepo.getColonies(91005);
      expect(charColonies).toHaveLength(6);
      expect(charColonies.every((c) => c.owner_id === 91005)).toBe(true);
    });
  });

  describe('2. Quantification des Stocks Planétaires & Valorisation Immuable', () => {
    it('TEST-P03-03: Extraction des stocks situés dans silos et spatioports sans doublon', async () => {
      await piService.ingestColoniesAndDetails(CHAR_MAIN, [samplePlanet1], {
        [TEST_PLANET_1]: sampleDetailPlanet1,
      });

      const aggregatedStocks = await piService.getAggregatedStocks([CHAR_MAIN]);

      // Doit inclure :
      // - 25,000 Microorganisms (P0) dans le silo 102
      // - 6,000 Microorganisms (P0) dans l'usine 103
      // - 40 Bacteria (P1) dans l'usine 103
      // - 1,200 Bacteria (P1) dans le spatioport 104
      expect(aggregatedStocks).toHaveLength(4);

      const siloStock = aggregatedStocks.find((s) => s.pinId === 102);
      expect(siloStock).toBeDefined();
      expect(siloStock?.quantity).toBe(25000);
      expect(siloStock?.typeId).toBe(2073);
      expect(siloStock?.tier).toBe('P0');
      expect(siloStock?.valuationStatus).toBe('KNOWN');
      expect(siloStock?.estimatedTotalValue).toBe(25000 * 12.0); // Microorganisms = 12.0 ISK standard

      const spaceportStock = aggregatedStocks.find((s) => s.pinId === 104);
      expect(spaceportStock).toBeDefined();
      expect(spaceportStock?.quantity).toBe(1200);
      expect(spaceportStock?.typeId).toBe(2393);
      expect(spaceportStock?.tier).toBe('P1');
      expect(spaceportStock?.estimatedTotalValue).toBe(1200 * 640.0); // Bacteria = 640.0 ISK standard
    });

    it('TEST-P03-04: Règle d’Or : un matériau PI inconnu ne vaut JAMAIS 0.00 ISK (strictement null / UNKNOWN)', async () => {
      const unknownDetail: RawEsiPlanetDetail = {
        links: [],
        routes: [],
        pins: [
          {
            pin_id: 999,
            type_id: 2256, // Storage
            latitude: 0,
            longitude: 0,
            contents: [
              { type_id: 99999999, amount: 500 }, // Type non répertorié
            ],
          },
        ],
      };

      await piService.ingestColoniesAndDetails(CHAR_MAIN, [samplePlanet1], {
        [TEST_PLANET_1]: unknownDetail,
      });

      const summaries = await piService.getColonySummaries(CHAR_MAIN);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].totalStockUnits).toBe(500);
      expect(summaries[0].valuationStatus).toBe('UNKNOWN');
      expect(summaries[0].estimatedStockValueIsk).toBeNull(); // Strictement null !
    });
  });

  describe('3. Intégration du Capital : État Mutuellement Exclusif PLANETARY_COLONY_STOCK', () => {
    it('TEST-P03-05: Intègre PLANETARY_COLONY_STOCK dans CapitalService avec invariance arithmétique exacte', async () => {
      await piService.ingestColoniesAndDetails(CHAR_MAIN, [samplePlanet1], {
        [TEST_PLANET_1]: sampleDetailPlanet1,
      });

      const assetsRepo = new InMemoryAssetsRepository(null);
      const ordersRepo = new InMemoryOrdersRepository(null);
      const roiRepo = new RoiRepository(ledgerRepo, null);
      const hubsRepo = new HubsRepository(null);
      const hubsService = new HubsService(hubsRepo);
      const walletRepo = new WalletRepository(null as unknown as IDatabaseAdapter);

      const capitalService = new CapitalService(
        assetsRepo,
        ordersRepo,
        ledgerRepo,
        roiRepo,
        hubsService,
        undefined,
        walletRepo,
        piRepo
      );

      const positions = capitalService.getPositions(CHAR_MAIN);
      const piPositions = positions.filter((p) => p.primaryClassification === 'PLANETARY_COLONY_STOCK');

      expect(piPositions.length).toBeGreaterThan(0);
      for (const pos of piPositions) {
        expect(pos.primaryClassification).toBe('PLANETARY_COLONY_STOCK');
        expect(pos.decompositionProof.isSumExact).toBe(true);
        expect(pos.decompositionProof.planetaryColony).toBe(pos.totalPhysicalQuantity);
        expect(pos.locationType).toBe('planet');
      }

      const summary = capitalService.getCapitalSummary(CHAR_MAIN);
      expect(summary.physicalSummary.planetaryColonyStockUnits).toBe(
        25000 + 6000 + 40 + 1200
      );
    });
  });

  describe('4. Cadences Horaires & Prévisions d\'Épuisement des Silos', () => {
    it('TEST-P03-06: Calcule les cadences horaires d\'extraction et de production industrielle', async () => {
      await piService.ingestColoniesAndDetails(CHAR_MAIN, [samplePlanet1], {
        [TEST_PLANET_1]: sampleDetailPlanet1,
      });

      const summaries = await piService.getColonySummaries(CHAR_MAIN);
      const colony = summaries[0];

      expect(colony.activeExtractorsCount).toBe(1);
      // Extractor: 1500 units / 900s * 3600s = 6,000 units/h
      expect(colony.hourlyExtractionUnits).toBe(6000);
      expect(colony.hourlyExtractionVolumeM3).toBe(60); // 6,000 * 0.01 m3

      expect(colony.activeProcessorsCount).toBe(1);
      // Basic Industry Facility: 2 cycles/h * 20 units = 40 units/h
      expect(colony.hourlyProductionUnits).toBe(40);
      expect(colony.hourlyProductionVolumeM3).toBe(40 * 0.38); // Bacteria P1 = 0.38 m3
    });

    it('TEST-P03-07: Prédit le délai d\'épuisement des stocks tampons lorsque la consommation dépasse la production', async () => {
      // Configuration où le silo 102 a 12,000 unités de P0, et la route sortante vers l'usine consomme 6,000 u/h sans entrée
      const detailWithDepletion: RawEsiPlanetDetail = {
        links: [],
        pins: [
          {
            pin_id: 102,
            type_id: 2256, // Storage
            latitude: 0,
            longitude: 0,
            contents: [{ type_id: 2073, amount: 12000 }],
          },
        ],
        routes: [
          {
            route_id: 10,
            source_pin_id: 102,
            destination_pin_id: 103, // Vers l'usine
            content_type_id: 2073,
            quantity: 3000, // Consommation 3000 u/h
          },
        ],
      };

      await piService.ingestColoniesAndDetails(CHAR_MAIN, [samplePlanet1], {
        [TEST_PLANET_1]: detailWithDepletion,
      });

      const detail = await piService.getColonyDetail(CHAR_MAIN, TEST_PLANET_1);
      expect(detail).not.toBeNull();
      expect(detail?.depletionForecasts).toHaveLength(1);

      const forecast = detail!.depletionForecasts[0];
      expect(forecast.pinId).toBe(102);
      expect(forecast.consumptionPerHour).toBe(3000);
      expect(forecast.netRatePerHour).toBe(-3000);
      // 12000 / 3000 = 4.0 heures avant épuisement
      expect(forecast.hoursUntilDepletion).toBe(4.0);
      expect(forecast.estimatedDepletionDate).not.toBeNull();
    });
  });

  describe('5. Taxes Douanières POCO (Planetary Customs Offices) & Imputation TTC', () => {
    it('TEST-P03-08: Calcule rigoureusement les taxes d\'exportation POCO selon les règles officielles CCP', async () => {
      // Sauvegarder le bureau de douane POCO dans le référentiel
      await piRepo.saveCustomsOffices([samplePOCO]);
      const savedPOCO = piRepo.getCustomsOffice(TEST_SYSTEM);
      expect(savedPOCO?.corporation_tax_rate).toBe(0.04);

      // Pour 1,000 unités de Bacteria (P1) avec pocoTaxRate explicite de 5%
      // Base Customs Value P1 = 400.0 ISK
      // SCC Tax = 10%
      // POCO Corp Tax = 5%
      // Total Tax Rate = 15%
      const exportTax = piService.calculateExportTax({
        typeId: 2393, // Bacteria
        quantity: 1000,
        pocoTaxRate: 0.05,
      });

      expect(exportTax.tier).toBe('P1');
      expect(exportTax.baseCustomsUnitValue).toBe(400.0);
      expect(exportTax.sccTaxRate).toBe(0.10);
      expect(exportTax.pocoTaxRate).toBe(0.05);
      expect(exportTax.totalTaxRate).toBe(0.15);

      // SCC Tax = 400 * 0.10 * 1000 = 40,000 ISK
      expect(exportTax.sccTaxIsk).toBe(40000);
      // POCO Tax = 400 * 0.05 * 1000 = 20,000 ISK
      expect(exportTax.pocoTaxIsk).toBe(20000);
      // Total Export Tax = 60,000 ISK
      expect(exportTax.totalExportTaxIsk).toBe(60000);
      expect(exportTax.allocatedUnitTaxIsk).toBe(60);
    });

    it('TEST-P03-09: Impute les écritures de taxes réelles du journal de portefeuille (planetary_export_tax) au coût de revient TTC', () => {
      // Simuler une écriture dans le journal de portefeuille EVE
      ledgerRepo.saveJournalEntries([
        {
          id: 'char:95001:777001',
          characterId: CHAR_MAIN,
          journalId: 777001,
          date: '2026-10-12T02:00:00Z',
          refType: 'planetary_export_tax',
          amount: -120000, // 120,000 ISK débités
          description: 'Planetary export tax payment',
          source: `/characters/${CHAR_MAIN}/wallet/journal/`,
          observedAt: Date.now(),
        },
      ]);

      const batches = [
        { typeId: 2393, quantity: 2000 }, // Bacteria (P1)
      ];

      const imputed = piService.imputeExportTaxesToLandedLots(CHAR_MAIN, batches);
      expect(imputed).toHaveLength(1);
      expect(imputed[0].isTaxReconciledFromJournal).toBe(true);
      expect(imputed[0].totalLandedTaxIsk).toBe(120000);
      expect(imputed[0].allocatedUnitTaxIsk).toBe(60); // 120,000 / 2,000 = 60 ISK/u
    });
  });

  describe('6. Endpoints REST & Contrôle d\'Accès Multi-Personnages (/api/pi)', () => {
    it('TEST-P03-10: GET /api/pi/colonies requiert une session valide et renvoie les colonies autorisées', async () => {
      // 1. Sans session -> 401
      const unauthRes = await request(app).get('/api/pi/colonies');
      expect(unauthRes.status).toBe(401);

      // Ingestion des colonies pour CHAR_MAIN et CHAR_ALT1
      await piService.ingestColoniesAndDetails(CHAR_MAIN, [samplePlanet1], {
        [TEST_PLANET_1]: sampleDetailPlanet1,
      });
      await piService.ingestColoniesAndDetails(CHAR_ALT1, [samplePlanet2], {
        [TEST_PLANET_2]: { links: [], pins: [], routes: [] },
      });

      // 2. Avec session valide pour la flotte -> 200 OK
      const authRes = await request(app)
        .get('/api/pi/colonies')
        .set('Cookie', ['eve_session_id=test-session-pi']);

      expect(authRes.status).toBe(200);
      expect(authRes.body.colonies).toHaveLength(2);
      expect(authRes.body.total).toBe(2);
    });

    it('TEST-P03-11: GET /api/pi/colonies/:id renvoie les détails complets ou 404 si non trouvée', async () => {
      await piService.ingestColoniesAndDetails(CHAR_MAIN, [samplePlanet1], {
        [TEST_PLANET_1]: sampleDetailPlanet1,
      });

      const resOk = await request(app)
        .get(`/api/pi/colonies/${TEST_PLANET_1}`)
        .set('Cookie', ['eve_session_id=test-session-pi']);

      expect(resOk.status).toBe(200);
      expect(resOk.body.planetId).toBe(TEST_PLANET_1);
      expect(resOk.body.pins).toHaveLength(5);
      expect(resOk.body.routes).toHaveLength(3);

      const res404 = await request(app)
        .get('/api/pi/colonies/999999')
        .set('Cookie', ['eve_session_id=test-session-pi']);

      expect(res404.status).toBe(404);
    });

    it('TEST-P03-12: POST /api/pi/calculate-export-tax valide les entrées et calcule les taxes', async () => {
      const res = await request(app)
        .post('/api/pi/calculate-export-tax')
        .set('Cookie', ['eve_session_id=test-session-pi'])
        .send({
          typeId: 2393,
          quantity: 500,
          pocoTaxRate: 0.10,
        });

      expect(res.status).toBe(200);
      expect(res.body.typeId).toBe(2393);
      expect(res.body.totalExportTaxIsk).toBe(40000); // 400 * (0.10 + 0.10) * 500 = 40,000
    });

    it('TEST-P03-13: Rejette l\'accès pour un personnage externe à la session (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/pi/colonies?character_id=${CHAR_UNAUTHORIZED}`)
        .set('Cookie', ['eve_session_id=test-session-pi']);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Accès refusé');
    });
  });
});
