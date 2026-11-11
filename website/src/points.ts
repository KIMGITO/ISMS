import type { Storefront } from './api';

/** Is the shop running reward points? Older databases don't say, which means yes. */
export const pointsOn = (site: Pick<Storefront, 'loyalty'> | null | undefined) => site?.loyalty?.enabled !== false;
