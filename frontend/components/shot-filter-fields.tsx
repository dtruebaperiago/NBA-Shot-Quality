"use client";

import { basketDistanceBands, defenderOptions, withShotValue, type ShotFilterOptions, type ShotFilters, type ShotValueFilter } from "../lib/shots";
import { SelectField } from "./ui";

export function ShotFilterFields({ filters, onChange, options }: { filters: ShotFilters; onChange: (filters: ShotFilters) => void; options: ShotFilterOptions }) {
  const set = (field: Exclude<keyof ShotFilters, "value">, value: string) => onChange({ ...filters, [field]: value });
  const { zones, families } = options[filters.value];
  return <div className="advanced-fields">
    <SelectField label="Shot value" value={filters.value} onChange={event => onChange(withShotValue(filters, event.target.value as ShotValueFilter, options))}><option value="">Any value</option><option value="2">2PT</option><option value="3">3PT</option></SelectField>
    <SelectField label="Zone" value={filters.zone} onChange={event => set("zone", event.target.value)}><option value="">Any zone</option>{zones.map(zone => <option key={zone}>{zone}</option>)}</SelectField>
    <SelectField label="Shot type" value={filters.family} onChange={event => set("family", event.target.value)}><option value="">Any shot type</option>{families.map(family => <option key={family}>{family}</option>)}</SelectField>
    <SelectField label="Basket distance" value={filters.distance} onChange={event => set("distance", event.target.value)}><option value="">Any distance</option>{basketDistanceBands.filter(band => !filters.value || String(band.value) === filters.value).map(band => <option key={band.id} value={band.id}>{filters.value ? band.label : `${band.value}PT · ${band.label}`}</option>)}</SelectField>
    <SelectField label="Defender" value={filters.defender} onChange={event => set("defender", event.target.value)}><option value="">Any distance</option>{defenderOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</SelectField>
    <SelectField label="Shot clock" value={filters.clock} onChange={event => set("clock", event.target.value)}><option value="">Any clock</option><option value="early">15+ s</option><option value="late">Under 7 s</option></SelectField>
  </div>;
}
