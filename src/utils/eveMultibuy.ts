/**
 * EVE Online Multibuy formatting utility
 * Outputs format recognizable by EVE Client Multibuy window:
 * <Item Name> <Quantity>
 */

import { RestockItem } from '../App';

export function formatEveMultibuy(items: RestockItem[]): string {
  return items
    .filter((item) => item.targetQuantity > 0)
    .map((item) => `${item.typeName}\t${item.targetQuantity}`)
    .join('\n');
}

export function formatEveMultibuySpace(items: RestockItem[]): string {
  return items
    .filter((item) => item.targetQuantity > 0)
    .map((item) => `${item.typeName} ${item.targetQuantity}`)
    .join('\n');
}
