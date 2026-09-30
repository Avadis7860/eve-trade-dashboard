import { describe, it, expect } from 'vitest';
import { formatEveMultibuy, formatEveMultibuySpace } from './eveMultibuy';
import { RestockItem } from '../App';

describe('EVE Multibuy Utilities', () => {
  const items: RestockItem[] = [
    {
      id: '1',
      characterId: 100,
      typeId: 34,
      typeName: 'Tritanium',
      targetBuyHubId: 60003760,
      targetBuyHubName: 'Jita 4-4',
      sellHubId: 60008494,
      sellHubName: 'Amarr 8',
      suggestedQuantity: 100000,
      targetQuantity: 100000,
      status: 'SUGGESTED',
      justification: 'Restock',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: '2',
      characterId: 100,
      typeId: 35,
      typeName: 'Pyerite',
      targetBuyHubId: 60003760,
      targetBuyHubName: 'Jita 4-4',
      sellHubId: 60008494,
      sellHubName: 'Amarr 8',
      suggestedQuantity: 25000,
      targetQuantity: 25000,
      status: 'PLANNED',
      justification: 'Restock',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  it('formats items with tab separators for EVE multibuy paste', () => {
    const formatted = formatEveMultibuy(items);
    expect(formatted).toBe('Tritanium\t100000\nPyerite\t25000');
  });

  it('formats items with space separators', () => {
    const formatted = formatEveMultibuySpace(items);
    expect(formatted).toBe('Tritanium 100000\nPyerite 25000');
  });
});
