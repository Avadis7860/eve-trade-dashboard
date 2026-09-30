export interface EveTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

export interface EveJwtPayload {
  sub: string; // e.g. "CHARACTER:EVE:2112345678"
  name: string;
  owner?: string;
  scp?: string[] | string;
  exp: number;
  iss: string;
  azp?: string;
  tenant?: string;
  tier?: string;
  region?: string;
}

export interface CharacterIdentity {
  characterId: number;
  characterName: string;
  ownerHash?: string;
  scopes: string[];
}

export interface LinkedCharacter {
  characterId: number;
  characterName: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  createdAt: number;
}

export interface UserSession {
  sessionId: string;
  activeCharacterId: number;
  characterId: number;
  characterName: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // UNIX timestamp in ms
  createdAt: number;
  characters: Record<number, LinkedCharacter>;
}

export interface PublicCharacterInfo {
  characterId: number;
  characterName: string;
  portraitUrl: string;
  scopes: string[];
  expiresAt: number;
  isActive: boolean;
}

export interface PublicSessionInfo {
  authenticated: boolean;
  character?: {
    characterId: number;
    characterName: string;
    portraitUrl: string;
    scopes: string[];
    expiresAt: number;
  };
  characters?: PublicCharacterInfo[];
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes: string[];
  authBaseUrl: string;
  tokenBaseUrl: string;
}
