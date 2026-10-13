// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  IndustryActivityId,
  getIndustryActivityName,
  type IndustryJob,
} from './types.ts';
import { IndustryRepository } from './repository.ts';
import { IndustryService, STANDARD_BLUEPRINTS } from './service.ts';
import { createIndustryRouter } from './router.ts';
import { IndustryCollector } from './collector.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import type { RawEsiIndustryJob } from '../esi/types.ts';
import { PersistentLedgerRepository } from '../ledger/repository.ts';
import { UniverseService } from '../universe/service.ts';
import { AuthService } from '../auth/service.ts';
import { SessionStore } from '../auth/sessionStore.ts';
import { DurableFileDatabaseAdapter } from '../storage/database.ts';

describe('Phase P04 — Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours (WIP)', () => {
  let adapter: DurableFileDatabaseAdapter;
  let ledgerRepo: PersistentLedgerRepository;
  let industryRepo: IndustryRepository;
  let universeService: UniverseService;
  let industryService: IndustryService;
  let sessionStore: SessionStore;
  let authService: AuthService;
  let app: express.Express;
  let sessionToken: string;

  const testCharId = 5001;
  const secondaryCharId = 5002;
  const foreignCharId = 9999;
  const testCorpId = 980001;

  beforeEach(() => {
    adapter = new DurableFileDatabaseAdapter(null);
    adapter.init();

    ledgerRepo = new PersistentLedgerRepository(adapter);
    industryRepo = new IndustryRepository(adapter);
    universeService = new UniverseService();
    industryService = new IndustryService(industryRepo, ledgerRepo, universeService);

    sessionStore = new SessionStore(adapter);
    authService = new AuthService(undefined, sessionStore);

    // Setup session with multi-character access
    const session = sessionStore.createSession({
      characterId: testCharId,
      characterName: 'Industrial Tycoon',
      scopes: [
        'esi-industry.read_character_jobs.v1',
        'esi-industry.read_corporation_jobs.v1',
        'esi-wallet.read_character_wallet.v1',
      ],
      accessToken: 'access-token-5001',
      refreshToken: 'refresh-token-5001',
      expiresAt: Date.now() + 3600000,
    });
    session.characters = {
      [testCharId]: {
        characterId: testCharId,
        characterName: 'Industrial Tycoon',
        scopes: ['esi-industry.read_character_jobs.v1'],
        accessToken: 'access-token-5001',
        refreshToken: 'refresh-token-5001',
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      },
      [secondaryCharId]: {
        characterId: secondaryCharId,
        characterName: 'Alt Researcher',
        scopes: ['esi-industry.read_character_jobs.v1'],
        accessToken: 'access-token-5002',
        refreshToken: 'refresh-token-5002',
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      },
    };
    sessionToken = session.sessionId;

    // Express app for REST tests
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/industry', createIndustryRouter(industryService, authService));
  });

  const mockRawJobs: RawEsiIndustryJob[] = [
    {
      activity_id: 1, // Manufacturing
      blueprint_id: 10001,
      blueprint_location_id: 60003760,
      blueprint_type_id: 688, // Caracal Blueprint
      cost: 175000,
      duration: 7200,
      end_date: new Date(Date.now() + 3600000).toISOString(),
      facility_id: 60003760,
      installer_id: testCharId,
      job_id: 91001,
      output_location_id: 60003760,
      product_type_id: 621, // Caracal
      runs: 2,
      start_date: new Date(Date.now() - 3600000).toISOString(),
      station_id: 60003760,
      status: 'active',
    },
    {
      activity_id: 3, // TE Research
      blueprint_id: 10002,
      blueprint_location_id: 60003760,
      blueprint_type_id: 684, // Rifter Blueprint
      cost: 45000,
      duration: 3600,
      end_date: new Date(Date.now() + 1800000).toISOString(),
      facility_id: 60003760,
      installer_id: testCharId,
      job_id: 91002,
      output_location_id: 60003760,
      runs: 1,
      start_date: new Date(Date.now() - 1800000).toISOString(),
      station_id: 60003760,
      status: 'active',
    },
    {
      activity_id: 9, // Reactions
      blueprint_id: 10003,
      blueprint_location_id: 60003760,
      blueprint_type_id: 99999, // Unknown reaction formula
      cost: 85000,
      duration: 10800,
      end_date: new Date(Date.now() - 10000).toISOString(),
      facility_id: 60003760,
      installer_id: testCharId,
      job_id: 91003,
      output_location_id: 60003760,
      runs: 5,
      start_date: new Date(Date.now() - 11000000).toISOString(),
      station_id: 60003760,
      status: 'ready',
    },
    {
      activity_id: 1, // Manufacturing
      blueprint_id: 10004,
      blueprint_location_id: 60003760,
      blueprint_type_id: 685, // Tristan Blueprint
      cost: 32000,
      duration: 3600,
      end_date: new Date(Date.now() - 86400000).toISOString(),
      facility_id: 60003760,
      installer_id: secondaryCharId,
      job_id: 91004,
      output_location_id: 60003760,
      product_type_id: 593,
      runs: 1,
      start_date: new Date(Date.now() - 90000000).toISOString(),
      station_id: 60003760,
      status: 'delivered',
    },
  ];

  describe('1. Activity IDs, Job Models & Nomenclature Types', () => {
    it('properly maps all canonical EVE industry activity IDs', () => {
      expect(getIndustryActivityName(IndustryActivityId.MANUFACTURING)).toBe('Manufacturing');
      expect(getIndustryActivityName(IndustryActivityId.TE_RESEARCH)).toBe('Time Efficiency Research');
      expect(getIndustryActivityName(IndustryActivityId.ME_RESEARCH)).toBe('Material Efficiency Research');
      expect(getIndustryActivityName(IndustryActivityId.COPYING)).toBe('Copying');
      expect(getIndustryActivityName(IndustryActivityId.INVENTION)).toBe('Invention');
      expect(getIndustryActivityName(IndustryActivityId.REACTIONS)).toBe('Reactions');
      expect(getIndustryActivityName(999)).toBe('Activity #999');
    });

    it('contains standard blueprint definitions for manufacturing', () => {
      const caracalBp = STANDARD_BLUEPRINTS[688];
      expect(caracalBp).toBeDefined();
      expect(caracalBp.productTypeId).toBe(621);
      expect(caracalBp.productTypeName).toBe('Caracal');
      expect(caracalBp.materials.length).toBeGreaterThan(0);

      const tritanium = caracalBp.materials.find((m) => m.typeId === 34);
      expect(tritanium).toBeDefined();
      expect(tritanium!.quantity).toBe(380000);
    });
  });

  describe('2. IndustryRepository Persistence & Querying', () => {
    it('saves jobs idempotently and supports updates without losing data', async () => {
      const initialJob: IndustryJob = {
        jobId: 901,
        installerId: testCharId,
        facilityId: 60003760,
        stationId: 60003760,
        activityId: 1,
        activityName: 'Manufacturing',
        blueprintId: 101,
        blueprintTypeId: 688,
        blueprintLocationId: 60003760,
        outputLocationId: 60003760,
        status: 'active',
        duration: 3600,
        startDate: '2026-10-10T12:00:00Z',
        endDate: '2026-10-10T13:00:00Z',
        runs: 1,
        cost: 150000,
        source: 'CHARACTER',
        characterId: testCharId,
        observedAt: Date.now(),
      };

      const res1 = await industryRepo.saveJobs([initialJob]);
      expect(res1.inserted).toBe(1);
      expect(res1.updated).toBe(0);

      // Verify retrieval
      const fetched = industryRepo.getJobById(901);
      expect(fetched).toBeDefined();
      expect(fetched!.status).toBe('active');

      // Update to delivered
      const updatedJob: IndustryJob = {
        ...initialJob,
        status: 'delivered',
        completedDate: '2026-10-10T13:00:05Z',
      };
      const res2 = await industryRepo.saveJobs([updatedJob]);
      expect(res2.inserted).toBe(0);
      expect(res2.updated).toBe(1);

      const fetched2 = industryRepo.getJobById(901);
      expect(fetched2!.status).toBe('delivered');
      expect(fetched2!.completedDate).toBe('2026-10-10T13:00:05Z');
    });

    it('filters jobs by character, status, activity, and installer', async () => {
      await industryService.ingestRawJobs(testCharId, mockRawJobs.slice(0, 3), 'CHARACTER');
      await industryService.ingestRawJobs(secondaryCharId, [mockRawJobs[3]], 'CHARACTER');

      // Filter by status 'active'
      const activeJobs = industryRepo.getJobs({ status: 'active' });
      expect(activeJobs.length).toBe(2);

      // Filter by activity Manufacturing (1)
      const mfgJobs = industryRepo.getJobs({ activityId: 1 });
      expect(mfgJobs.length).toBe(2);

      // Filter by characterId
      const charJobs = industryRepo.getJobs({ characterId: testCharId });
      expect(charJobs.length).toBe(3);

      // Filter by secondary character
      const altJobs = industryRepo.getJobs({ characterId: secondaryCharId });
      expect(altJobs.length).toBe(1);
      expect(altJobs[0].jobId).toBe(91004);
    });
  });

  describe('3. Bill of Materials (BOM) Resolution', () => {
    it('resolves full BOM for known blueprint and scales materials with runs', async () => {
      const job: IndustryJob = {
        jobId: 92001,
        installerId: testCharId,
        facilityId: 60003760,
        stationId: 60003760,
        activityId: 1,
        activityName: 'Manufacturing',
        blueprintId: 101,
        blueprintTypeId: 688, // Caracal Blueprint
        blueprintLocationId: 60003760,
        outputLocationId: 60003760,
        status: 'active',
        duration: 7200,
        startDate: '2026-10-10T12:00:00Z',
        endDate: '2026-10-10T14:00:00Z',
        runs: 3, // 3 runs
        cost: 250000,
        source: 'CHARACTER',
        characterId: testCharId,
        observedAt: Date.now(),
      };
      await industryRepo.saveJobs([job]);

      const bom = industryService.getJobBom(92001);
      expect(bom.blueprintTypeId).toBe(688);
      expect(bom.runs).toBe(3);
      expect(bom.product.typeId).toBe(621);
      expect(bom.product.totalQuantity).toBe(3); // 1 per run * 3 runs

      // Materials scaled by runs
      const trit = bom.materials.find((m) => m.typeId === 34);
      expect(trit).toBeDefined();
      expect(trit!.quantityPerRun).toBe(380000);
      expect(trit!.totalQuantity).toBe(380000 * 3);
      expect(trit!.unitCostIsk).toBeGreaterThan(0);
      expect(trit!.totalCostIsk).toBeGreaterThan(0);
      expect(trit!.costBasisStatus).toBe('KNOWN');

      expect(bom.installationCostIsk).toBe(250000);
      expect(bom.totalInputCostIsk).toBeGreaterThan(0);
      expect(bom.totalWipCostIsk).toBe(bom.totalInputCostIsk! + 250000);
      expect(bom.wipStatus).toBe('KNOWN');
    });

    it('handles unknown blueprints gracefully without inventing fake costs (UNKNOWN invariant)', async () => {
      const job: IndustryJob = {
        jobId: 92002,
        installerId: testCharId,
        facilityId: 60003760,
        stationId: 60003760,
        activityId: 9, // Reactions
        activityName: 'Reactions',
        blueprintId: 102,
        blueprintTypeId: 88888, // Custom non-catalog reaction formula
        blueprintLocationId: 60003760,
        outputLocationId: 60003760,
        status: 'active',
        duration: 3600,
        startDate: '2026-10-10T12:00:00Z',
        endDate: '2026-10-10T13:00:00Z',
        runs: 1,
        cost: 60000,
        source: 'CHARACTER',
        characterId: testCharId,
        observedAt: Date.now(),
      };
      await industryRepo.saveJobs([job]);

      const bom = industryService.getJobBom(92002);
      expect(bom.materials.length).toBe(0);
      expect(bom.totalInputCostIsk).toBeNull(); // Unknown inputs != 0.00 ISK!
      expect(bom.installationCostIsk).toBe(60000);
      expect(bom.totalWipCostIsk).toBe(60000); // At least installation fee is known
      expect(bom.wipStatus).toBe('UNKNOWN');
    });
  });

  describe('4. Deterministic Installation Fee Reconciliation & Double-Counting Guard', () => {
    it('reconciles job cost with industry_job_tax via exact contextId match', async () => {
      // Seed journal entry referencing job 91001 via contextId
      await ledgerRepo.saveJournalEntries([
        {
          id: `char:${testCharId}:77001`,
          characterId: testCharId,
          journalId: 77001,
          date: mockRawJobs[0].start_date,
          refType: 'industry_job_tax',
          amount: -175000, // Debited 175,000 ISK
          contextId: 91001,
          contextIdType: 'industry_job_id',
          description: 'Industry Job Installation Fee',
          source: 'esi:/characters/5001/wallet/journal/',
          observedAt: Date.now(),
        },
      ]);

      await industryService.ingestRawJobs(testCharId, [mockRawJobs[0]], 'CHARACTER');

      const reconciliation = await industryService.reconcileJobInstallationFees(testCharId);
      expect(reconciliation.totalJobsWithCost).toBe(1);
      expect(reconciliation.matchedFeeIsk).toBe(175000);
      expect(reconciliation.exactMatchesCount).toBe(1);
      expect(reconciliation.matchRatio).toBe(100);

      const job = industryRepo.getJobById(91001);
      expect(job!.installationFeeReconciliation).toBeDefined();
      expect(job!.installationFeeReconciliation!.status).toBe('EXACT_MATCH');
      expect(job!.installationFeeReconciliation!.matchedJournalId).toBe(77001);
      expect(job!.installationFeeReconciliation!.discrepancyIsk).toBe(0);
    });

    it('correlates job cost bijectively by timestamp and amount when contextId is omitted', async () => {
      const jobStartDate = '2026-10-11T14:00:00Z';
      const correlatedJob: RawEsiIndustryJob = {
        ...mockRawJobs[1],
        job_id: 93001,
        cost: 45000,
        start_date: jobStartDate,
      };

      // Seed journal entry matching date within 30 seconds and exact amount
      await ledgerRepo.saveJournalEntries([
        {
          id: `char:${testCharId}:77002`,
          characterId: testCharId,
          journalId: 77002,
          date: '2026-10-11T14:00:15Z', // 15 seconds after job start
          refType: 'facility_tax',
          amount: -45000,
          description: 'Facility Installation Tax',
          source: 'esi:/characters/5001/wallet/journal/',
          observedAt: Date.now(),
        },
      ]);

      await industryService.ingestRawJobs(testCharId, [correlatedJob], 'CHARACTER');
      const reconciliation = await industryService.reconcileJobInstallationFees(testCharId);

      expect(reconciliation.matchedFeeIsk).toBe(45000);
      expect(reconciliation.correlatedMatchesCount).toBe(1);

      const job = industryRepo.getJobById(93001);
      expect(job!.installationFeeReconciliation).toBeDefined();
      expect(job!.installationFeeReconciliation!.status).toBe('CORRELATED_BIJECTIVE');
      expect(job!.installationFeeReconciliation!.matchedJournalId).toBe(77002);
    });

    it('enforces 1-to-1 bijection: never matches the same journal entry to multiple jobs', async () => {
      // 1 single journal entry of 50000 ISK
      await ledgerRepo.saveJournalEntries([
        {
          id: `char:${testCharId}:77003`,
          characterId: testCharId,
          journalId: 77003,
          date: '2026-10-11T15:00:00Z',
          refType: 'industry_job_tax',
          amount: -50000,
          description: 'Job Tax',
          source: 'esi:/characters/5001/wallet/journal/',
          observedAt: Date.now(),
        },
      ]);

      // 2 jobs with identical cost started at the same time
      const jobA: RawEsiIndustryJob = {
        ...mockRawJobs[0],
        job_id: 94001,
        cost: 50000,
        start_date: '2026-10-11T15:00:00Z',
      };
      const jobB: RawEsiIndustryJob = {
        ...mockRawJobs[0],
        job_id: 94002,
        cost: 50000,
        start_date: '2026-10-11T15:00:00Z',
      };

      await industryService.ingestRawJobs(testCharId, [jobA, jobB], 'CHARACTER');
      const reconciliation = await industryService.reconcileJobInstallationFees(testCharId);

      // Only 1 job matched, the second is UNMATCHED
      expect(reconciliation.matchedFeeIsk).toBe(50000);
      expect(reconciliation.unmatchedFeeIsk).toBe(50000);
      expect(reconciliation.correlatedMatchesCount).toBe(1);
      expect(reconciliation.unmatchedCount).toBe(1);
    });
  });

  describe('5. Work-in-Progress (WIP) Capital Computation (WIP_INVENTORY_CAPITAL)', () => {
    it('accurately computes WIP capital = sum(inputs cost + installation fees) for active jobs', async () => {
      await industryService.ingestRawJobs(testCharId, mockRawJobs, 'CHARACTER');

      const wip = industryService.getWipCapital(testCharId);
      // Jobs 91001 (active Caracal) and 91002 (active Rifter research) are active
      expect(wip.activeJobsCount).toBe(2);

      // Installation fees: 175000 + 45000 = 220000
      expect(wip.totalInstallationFeesIsk).toBe(220000);
      expect(wip.totalInputsCostIsk).toBeGreaterThan(0);
      expect(wip.totalWipCommittedIsk).toBe(wip.totalInstallationFeesIsk + wip.totalInputsCostIsk);
      expect(wip.jobs.length).toBe(2);

      // Delivered job (91004) and ready job (91003) are NOT in active WIP
      const jobIdsInWip = wip.jobs.map((j) => j.jobId);
      expect(jobIdsInWip).toContain(91001);
      expect(jobIdsInWip).toContain(91002);
      expect(jobIdsInWip).not.toContain(91003);
      expect(jobIdsInWip).not.toContain(91004);
    });

    it('demonstrates end-to-end lifecycle transition (launch -> active WIP -> delivery -> exits WIP)', async () => {
      const singleJob: RawEsiIndustryJob = {
        activity_id: 1,
        blueprint_id: 10099,
        blueprint_location_id: 60003760,
        blueprint_type_id: 684, // Rifter Blueprint
        cost: 20000,
        duration: 3600,
        end_date: new Date(Date.now() + 3600000).toISOString(),
        facility_id: 60003760,
        installer_id: testCharId,
        job_id: 99001,
        output_location_id: 60003760,
        product_type_id: 587,
        runs: 1,
        start_date: new Date(Date.now()).toISOString(),
        station_id: 60003760,
        status: 'active',
      };

      // Step 1: Ingest active job -> enters WIP
      await industryService.ingestRawJobs(testCharId, [singleJob], 'CHARACTER');
      const wip1 = industryService.getWipCapital(testCharId);
      expect(wip1.activeJobsCount).toBe(1);
      expect(wip1.totalInstallationFeesIsk).toBe(20000);
      expect(wip1.totalWipCommittedIsk).toBeGreaterThan(20000);

      // Step 2: Job completes and is delivered
      const deliveredJob: RawEsiIndustryJob = {
        ...singleJob,
        status: 'delivered',
        completed_date: new Date().toISOString(),
      };
      await industryService.ingestRawJobs(testCharId, [deliveredJob], 'CHARACTER');

      // Step 3: Job has exited WIP
      const wip2 = industryService.getWipCapital(testCharId);
      expect(wip2.activeJobsCount).toBe(0);
      expect(wip2.totalWipCommittedIsk).toBe(0);
    });
  });

  describe('6. Industry Summary & Segregation', () => {
    it('provides complete overview with status and activity breakdowns', async () => {
      await industryService.ingestRawJobs(testCharId, mockRawJobs.slice(0, 3), 'CHARACTER');
      await industryService.ingestRawJobs(testCharId, [mockRawJobs[3]], 'CORPORATION', testCorpId);

      const summary = await industryService.getSummary(testCharId);
      expect(summary.totalJobsCount).toBe(4);
      expect(summary.activeJobsCount).toBe(2);
      expect(summary.readyJobsCount).toBe(1);
      expect(summary.deliveredJobsCount).toBe(1);
      expect(summary.characterJobsCount).toBe(3);
      expect(summary.corporationJobsCount).toBe(1);

      expect(summary.jobsByActivity['Manufacturing']).toBe(2);
      expect(summary.jobsByActivity['Time Efficiency Research']).toBe(1);
      expect(summary.jobsByActivity['Reactions']).toBe(1);

      expect(summary.wipSummary.activeJobsCount).toBe(2);
      expect(summary.upcomingCompletions.length).toBe(2);
      expect(summary.upcomingCompletions[0].jobId).toBeDefined();
    });
  });

  describe('7. REST API Endpoints & Security (/api/industry)', () => {
    beforeEach(async () => {
      await industryService.ingestRawJobs(testCharId, mockRawJobs.slice(0, 3), 'CHARACTER');
      await industryService.ingestRawJobs(secondaryCharId, [mockRawJobs[3]], 'CHARACTER');
    });

    it('enforces 401 when request is unauthenticated', async () => {
      const res = await request(app).get('/api/industry/jobs');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Authentication required');
    });

    it('returns filtered jobs list on GET /api/industry/jobs', async () => {
      const res = await request(app)
        .get('/api/industry/jobs')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.jobs.length).toBe(4);
      expect(res.body.total).toBe(4);
    });

    it('filters jobs by status on GET /api/industry/jobs?status=active', async () => {
      const res = await request(app)
        .get('/api/industry/jobs?status=active')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.jobs.length).toBe(2);
      expect(res.body.jobs.every((j: IndustryJob) => j.status === 'active')).toBe(true);
    });

    it('returns summary on GET /api/industry/summary', async () => {
      const res = await request(app)
        .get('/api/industry/summary')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.totalJobsCount).toBe(4);
      expect(res.body.activeJobsCount).toBe(2);
      expect(res.body.wipSummary).toBeDefined();
    });

    it('returns WIP capital details on GET /api/industry/wip-capital', async () => {
      const res = await request(app)
        .get('/api/industry/wip-capital')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.activeJobsCount).toBe(2);
      expect(res.body.totalInstallationFeesIsk).toBe(220000);
      expect(res.body.totalWipCommittedIsk).toBeGreaterThan(220000);
    });

    it('returns BOM definition on GET /api/industry/bom/:blueprintTypeId', async () => {
      const res = await request(app)
        .get('/api/industry/bom/688')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(true);
      expect(res.body.blueprint.blueprintTypeId).toBe(688);
      expect(res.body.blueprint.productTypeName).toBe('Caracal');
      expect(res.body.blueprint.materials.length).toBe(7);
    });

    it('enforces 403 on foreign character requests', async () => {
      const res = await request(app)
        .get(`/api/industry/jobs?character_id=${foreignCharId}`)
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Accès refusé');
    });

    it('triggers sync via POST /api/industry/sync with collector mock', async () => {
      const mockEsiClient = new EsiClient(
        { baseUrl: 'https://esi.evetech.net', timeoutMs: 3000 },
        new EsiCache(),
        new EsiRateLimiter(5)
      );
      const customCollector = new IndustryCollector(mockEsiClient);
      const customApp = express();
      customApp.use(express.json());
      customApp.use(cookieParser());
      customApp.use('/api/industry', createIndustryRouter(industryService, authService, customCollector));

      // Mock collectCharacterJobs
      customCollector.collectCharacterJobs = async () => ({
        characterId: testCharId,
        status: 'COMPLETE',
        characterJobs: [mockRawJobs[0]],
        totalJobs: 1,
        durationMs: 10,
        asOf: Date.now(),
      });

      const res = await request(customApp)
        .post('/api/industry/sync')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.charactersProcessed).toBeGreaterThan(0);
    });
  });
});
