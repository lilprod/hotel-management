import { createContext, useContext } from 'react';

/** Property currently edited by the settings pages. */
export const PropertyContext = createContext<string | null>(null);
export const usePropertyId = (): string | null => useContext(PropertyContext);
