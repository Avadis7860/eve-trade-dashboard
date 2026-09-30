import { describe, it, expect, beforeEach } from 'vitest';
import { hubsService } from './service';
import { hubsRepository } from './repository';

describe('Hubs Module (Trade Hubs & Location Mapping)', () => {
  beforeEach(() => {
    hubsRepository.resetToDefaults();
  });

  it('lists default major trade hubs', () => {
    const hubs = hubsService.listHubs();
    expect(hubs.length).toBeGreaterThanOrEqual(5);

    const jita = hubs.find((h) => h.id === 'hub-jita');
    expect(jita).toBeDefined();
    expect(jita?.is_system_default).toBe(true);

    const amarr = hubs.find((h) => h.id === 'hub-amarr');
    expect(amarr).toBeDefined();
  });

  it('resolves mapped stations to their respective trade hub', () => {
    const jitaStation = hubsService.resolveLocationToHub(60003760);
    expect(jitaStation.is_known_hub).toBe(true);
    expect(jitaStation.hub_id).toBe('hub-jita');
    expect(jitaStation.location_id).toBe(60003760);

    const dodixieStation = hubsService.resolveLocationToHub(60011866);
    expect(dodixieStation.is_known_hub).toBe(true);
    expect(dodixieStation.hub_id).toBe('hub-dodixie');
  });

  it('returns UNKNOWN_HUB for unmapped locations and never defaults to Jita or 0', () => {
    const unmappedStationId = 60009999;
    const resolved = hubsService.resolveLocationToHub(unmappedStationId, 'Some Remote Station');

    expect(resolved.is_known_hub).toBe(false);
    expect(resolved.hub_id).toBe('UNKNOWN_HUB');
    expect(resolved.location_id).toBe(unmappedStationId);
    expect(resolved.location_name).toBe('Some Remote Station');
  });

  it('allows creating, updating and deleting custom hubs', () => {
    const custom = hubsService.createOrUpdateHub({
      id: 'staging-nullsec',
      name: '1DQ1-A Keepstar Staging',
      system_name: '1DQ1-A',
      notes: 'Main deployment hub',
    });

    expect(custom.id).toBe('staging-nullsec');
    expect(custom.name).toBe('1DQ1-A Keepstar Staging');
    expect(custom.is_system_default).toBe(false);

    // Map a structure to this new hub
    hubsService.setMapping(1029384756, '1DQ1-A 1-SMEB Keepstar', 'staging-nullsec');

    const resolved = hubsService.resolveLocationToHub(1029384756);
    expect(resolved.is_known_hub).toBe(true);
    expect(resolved.hub_id).toBe('staging-nullsec');

    // Deleting custom hub deletes its mappings
    const deleteRes = hubsService.deleteHub('staging-nullsec');
    expect(deleteRes.success).toBe(true);

    const afterDelete = hubsService.resolveLocationToHub(1029384756);
    expect(afterDelete.is_known_hub).toBe(false);
    expect(afterDelete.hub_id).toBe('UNKNOWN_HUB');
  });

  it('forbids deleting system default hubs', () => {
    const res = hubsService.deleteHub('hub-jita');
    expect(res.success).toBe(false);
    expect(res.reason).toContain('Impossible de supprimer');

    const jita = hubsService.getHub('hub-jita');
    expect(jita).toBeDefined();
  });

  it('allows removing location mappings', () => {
    const initial = hubsService.resolveLocationToHub(60004588); // Rens
    expect(initial.is_known_hub).toBe(true);

    const removed = hubsService.removeMapping(60004588);
    expect(removed).toBe(true);

    const after = hubsService.resolveLocationToHub(60004588);
    expect(after.is_known_hub).toBe(false);
    expect(after.hub_id).toBe('UNKNOWN_HUB');
  });
});
