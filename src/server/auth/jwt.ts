import type { EveJwtPayload, CharacterIdentity } from './types.ts';

/**
 * Decodes and parses a JWT without external heavy dependencies, extracting payload
 */
export function parseJwtPayload(token: string): EveJwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: token must have 3 parts');
  }

  const payloadBase64 = parts[1]
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const padded = payloadBase64.padEnd(
    payloadBase64.length + ((4 - (payloadBase64.length % 4)) % 4),
    '='
  );

  const decodedJson = Buffer.from(padded, 'base64').toString('utf-8');
  return JSON.parse(decodedJson) as EveJwtPayload;
}

/**
 * Validates standard CCP SSO JWT claims and extracts character identity
 */
export function extractAndValidateCharacterIdentity(
  token: string,
  expectedClientId?: string
): CharacterIdentity {
  const payload = parseJwtPayload(token);

  // Validate issuer
  const validIssuers = ['login.eveonline.com', 'https://login.eveonline.com'];
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    throw new Error(`Invalid token issuer: ${payload.iss}`);
  }

  // Validate expiration
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowInSeconds) {
    throw new Error('Token has expired');
  }

  // Validate audience / azp if client ID is provided
  if (expectedClientId && payload.azp && payload.azp !== expectedClientId) {
    throw new Error(`Token azp mismatch: expected ${expectedClientId}, got ${payload.azp}`);
  }

  // Validate and parse character ID from subject
  if (!payload.sub || !payload.sub.startsWith('CHARACTER:EVE:')) {
    throw new Error(`Invalid subject format: ${payload.sub}`);
  }

  const characterIdStr = payload.sub.replace('CHARACTER:EVE:', '');
  const characterId = parseInt(characterIdStr, 10);
  if (isNaN(characterId) || characterId <= 0) {
    throw new Error(`Invalid character ID parsed from subject: ${characterIdStr}`);
  }

  if (!payload.name) {
    throw new Error('Character name missing in token claims');
  }

  // Normalize scopes
  let scopes: string[] = [];
  if (Array.isArray(payload.scp)) {
    scopes = payload.scp;
  } else if (typeof payload.scp === 'string') {
    scopes = payload.scp.split(' ').filter(Boolean);
  }

  return {
    characterId,
    characterName: payload.name,
    ownerHash: payload.owner,
    scopes,
  };
}
