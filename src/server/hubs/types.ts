export interface HubDefinition {
  id: string; // e.g. 'hub-jita', 'hub-amarr', 'custom-1'
  name: string; // e.g. 'Jita 4-4', 'Amarr VIII', 'Staging Nullsec'
  system_name?: string; // e.g. 'Jita', 'Amarr'
  is_system_default: boolean;
  notes?: string;
  created_at: string;
}

export interface HubLocationMapping {
  location_id: number; // EVE station_id or structure_id
  location_name: string;
  hub_id: string; // references HubDefinition.id or 'UNKNOWN_HUB'
  character_id?: number; // if character-specific or 0 for global
  updated_at: string;
  notes?: string;
}

export interface HubResolvedLocation {
  location_id: number;
  location_name: string;
  hub_id: string;
  hub_name: string;
  is_known_hub: boolean;
}
