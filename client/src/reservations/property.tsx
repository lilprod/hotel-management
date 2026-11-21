import { Select } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

import { useMeStore } from '../auth/session';

/** Property the staff member is working on (shared by planning, reservations, waitlist, groups). */

const STORAGE_KEY = 'hm.activeProperty';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface PropertyState {
  id: string | null;
  set: (id: string) => void;
}

export const usePropertyStore = create<PropertyState>()((set) => ({
  id: readStored(),
  set: (id) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode: the choice just lasts for the tab */
    }
    set({ id });
  },
}));

export function useActiveProperty() {
  const properties = useMeStore((s) => s.me?.properties) ?? [];
  const stored = usePropertyStore((s) => s.id);
  const set = usePropertyStore((s) => s.set);
  const valid = properties.some((p) => p.id === stored);
  const propertyId = valid ? stored : (properties[0]?.id ?? null);
  const first = properties[0]?.id;
  useEffect(() => {
    if (!valid && first) set(first);
  }, [valid, first, set]);
  return { properties, propertyId, setPropertyId: set };
}

export function PropertySelect({ style }: { style?: React.CSSProperties }) {
  const { t } = useTranslation('reservations');
  const { properties, propertyId, setPropertyId } = useActiveProperty();
  return (
    <Select
      aria-label={t('property')}
      value={propertyId ?? undefined}
      onChange={setPropertyId}
      options={properties.map((p) => ({ value: p.id, label: p.name }))}
      style={{ minWidth: 200, ...style }}
    />
  );
}
