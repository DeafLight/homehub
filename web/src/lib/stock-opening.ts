// Filtre demandé à l'ouverture de la page Stock (carte « À consommer » de l'accueil ou du dashboard d'un parent) :
// posé juste avant de naviguer, lu une seule fois par la page, qui sinon s'ouvre sur « En stock ».
import type { StockFilter } from './stock.ts';

let wanted: StockFilter | null = null;

export const openStockOn = (filter: StockFilter) => void (wanted = filter);

export function takeStockFilter(): StockFilter | null {
  const filter = wanted;
  wanted = null;
  return filter;
}
