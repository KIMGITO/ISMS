// Shared types for the app shell (App.tsx and the pieces in src/app).
import type { Business } from '../types';

/** The open branch, or a stand-in while the list is still loading. */
export type ActiveBusiness = Pick<Business, 'id' | 'name' | 'logoUrl'> & Partial<Business>;

export type ThemeMode = 'light' | 'dark';
