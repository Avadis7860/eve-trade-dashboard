/**
 * EVE Online Item Volume Registry and Cargo Capacity Helper (Phase 11)
 *
 * Provides base & packaged cargo volumes ($m^3$) for EVE items,
 * and calculates shipping logistics requirements across standard vessel classes.
 */

import type { CargoCapacityBenchmark } from './types.ts';

/**
 * Standard ship and cargo capacities in EVE Online (in m3)
 */
export const STANDARD_VESSELS: Array<{ vesselClass: string; name: string; capacityM3: number }> = [
  { vesselClass: 'BR', name: 'Blockade Runner (Prowler/Crane/Viator/Prorator)', capacityM3: 10_000 },
  { vesselClass: 'DST', name: 'Deep Space Transport (Occator/Bustard/Mastodon/Impel)', capacityM3: 60_000 },
  { vesselClass: 'Hauler', name: 'Standard Industrial (Tayra/Mammoth/Badger/Bestower)', capacityM3: 30_000 },
  { vesselClass: 'Freighter', name: 'Freighter (Charon/Obelisk/Providence/Fenrir)', capacityM3: 1_000_000 },
  { vesselClass: 'JF', name: 'Jump Freighter (Anshar/Nomad/Rhea/Ark)', capacityM3: 350_000 },
];

/**
 * Well known packaged and unit item volumes (in m3)
 */
const KNOWN_TYPE_VOLUMES: Record<number, number> = {
  // PLEX and Injectors
  44992: 0.01, // PLEX
  40520: 0.01, // Skill Injector
  40519: 0.01, // Skill Extractor
  52678: 0.01, // Daily Alpha Injector

  // Basic Minerals
  34: 0.01, // Tritanium
  35: 0.01, // Pyerite
  36: 0.01, // Mexallon
  37: 0.01, // Isogen
  38: 0.1,  // Nocxium
  39: 0.01, // Zydrine
  40: 0.01, // Megacyte
  11399: 0.01, // Morphite

  // Planetary Industry (P1 to P4 typical unit sizes)
  // P1: 0.38 m3, P2: 1.5 m3, P3: 6.0 m3, P4: 100.0 m3
  2389: 0.38, // Plasmoids
  2390: 0.38, // Electrolytes
  2392: 0.38, // Oxidizing Compound
  2393: 0.38, // Bacteria
  2395: 0.38, // Proteins
  2396: 0.38, // Biofuels
  2397: 0.38, // Industrial Fibers
  2398: 0.38, // Reactive Metals
  2399: 0.38, // Precious Metals
  2400: 0.38, // Toxic Metals
  2401: 0.38, // Chiral Structures

  // Common Ships (Packaged standard volumes in m3)
  // Frigates / Covert Ops / Interceptors: 2,500 m3
  587: 2500,  // Rifter
  603: 2500,  // Merlin
  598: 2500,  // Incursus
  599: 2500,  // Punisher
  11184: 2500, // Crusader
  11192: 2500, // Claw

  // Destroyers: 5,000 m3
  16242: 5000, // Thrasher
  16238: 5000, // Cormorant
  16236: 5000, // Coercer
  16240: 5000, // Catalyst

  // Cruisers: 10,000 m3
  620: 10000,  // Rupture
  621: 10000,  // Caracal
  622: 10000,  // Thorax
  624: 10000,  // Omen
  17715: 10000, // Gila
  17924: 10000, // Cerberus

  // Battlecruisers: 15,000 m3
  16227: 15000, // Ferox
  16229: 15000, // Brutix
  16231: 15000, // Drake
  16233: 15000, // Hurricane
  24690: 15000, // Harbinger

  // Battleships: 50,000 m3
  645: 50000,  // Dominix
  638: 50000,  // Raven
  642: 50000,  // Apocalypse
  643: 50000,  // Tempest
  17740: 50000, // Rattlesnake
  17920: 50000, // Machariel

  // Common Modules & Charges (0.01 to 20 m3)
  2048: 5.0,   // Damage Control II
  11269: 1.0,  // Gyrostabilizer II
  12058: 1.0,  // Ballistic Control System II
  20353: 20.0, // Large Shield Extender II
  10842: 5.0,  // 50MN Quad LiF Restrained Microwarpdrive
  438: 5.0,    // 1MN Afterburner II
  12745: 0.1,  // Scourge Heavy Missile
  2185: 0.05,  // Republic Fleet EMP S
};

export class VolumeRegistry {
  private customVolumes: Map<number, number> = new Map();

  /**
   * Retrieves unit volume in m3 for an item type
   */
  public getItemVolumeM3(typeId: number, typeName?: string): number {
    if (this.customVolumes.has(typeId)) {
      return this.customVolumes.get(typeId)!;
    }

    if (KNOWN_TYPE_VOLUMES[typeId] !== undefined) {
      return KNOWN_TYPE_VOLUMES[typeId];
    }

    // Heuristics based on name if known
    if (typeName) {
      const lower = typeName.toLowerCase();
      if (lower.includes('battleship') || lower.includes('marauder') || lower.includes('black ops')) {
        return 50000;
      }
      if (lower.includes('battlecruiser') || lower.includes('command ship')) {
        return 15000;
      }
      if (lower.includes('cruiser') || lower.includes('strategic cruiser') || lower.includes('hac')) {
        return 10000;
      }
      if (lower.includes('destroyer') || lower.includes('interdictor')) {
        return 5000;
      }
      if (lower.includes('frigate') || lower.includes('interceptor') || lower.includes('covert ops')) {
        return 2500;
      }
      if (lower.includes('large ') || lower.includes('800mm') || lower.includes('1400mm') || lower.includes('mega')) {
        return 20.0;
      }
      if (lower.includes('medium ') || lower.includes('425mm') || lower.includes('720mm') || lower.includes('heavy')) {
        return 10.0;
      }
      if (lower.includes('small ') || lower.includes('125mm') || lower.includes('light')) {
        return 5.0;
      }
      if (lower.includes('charge') || lower.includes('missile') || lower.includes('ammo') || lower.includes('capsule')) {
        return 0.1;
      }
      if (lower.includes('blueprint') || lower.includes('formula') || lower.includes('datacore')) {
        return 0.01;
      }
    }

    // Standard fallback default for unclassified general items
    return 0.1;
  }

  /**
   * Sets custom volume for a specific type_id
   */
  public setCustomVolume(typeId: number, volumeM3: number): void {
    this.customVolumes.set(typeId, Math.max(0.001, volumeM3));
  }

  /**
   * Calculates required trips across vessel classes for a given total m3 volume
   */
  public calculateVesselBenchmarks(totalVolumeM3: number): CargoCapacityBenchmark[] {
    const roundedTotal = Number(totalVolumeM3.toFixed(2));
    return STANDARD_VESSELS.map((v) => ({
      vesselClass: v.vesselClass,
      name: v.name,
      capacityM3: v.capacityM3,
      tripsNeeded: roundedTotal <= 0 ? 0 : Math.ceil(roundedTotal / v.capacityM3),
    }));
  }
}

export const defaultVolumeRegistry = new VolumeRegistry();
