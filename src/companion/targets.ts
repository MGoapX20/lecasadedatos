import type { EntryId } from './protocol';

export interface Target {
  name: string;
  short: string;
  domain: string;
  sector: string;
  color: string;
  style: 'orbital' | 'lab' | 'culture' | 'energy' | 'finance' | 'studio';
  headline: string;
  subline: string;
  account: string;
  vendor: string;
  datasets: [string, string, string];
  services: [string, string, string];
  endpoints: { path: string; entry: EntryId; kind: string }[];
}
export const TARGETS: Target[] = [
  {
    name: 'Aster Orbital',
    short: 'ASTER',
    domain: 'aster-orbital.example',
    sector: 'Orbital logistics',
    color: '#a5c8ff',
    style: 'orbital',
    headline: 'YOUR NEXT STOP.\nLOW EARTH ORBIT.',
    subline: 'Precision freight for a world beyond this one.',
    account: 'flight.director',
    vendor: 'Perihelion Dispatch',
    datasets: [
      'flight-manifests.parquet',
      'payload-designs.tar',
      'crew-identity.db',
    ],
    services: ['Mission control', 'Payload registry', 'Flight archive'],
    endpoints: [
      { path: '/flights', entry: 'front', kind: 'public index' },
      { path: '/crew/sign-in', entry: 'front', kind: 'identity' },
      { path: '/api/v1/telemetry', entry: 'side', kind: 'legacy API' },
      { path: '/partners/dispatch', entry: 'dock', kind: 'vendor trust' },
      { path: '/ground-station', entry: 'vent', kind: 'edge service' },
      { path: '/api/orbit/resolve', entry: 'sewer', kind: 'undocumented' },
      { path: '/payloads/catalog', entry: 'side', kind: 'object store' },
      { path: '/crew/directory', entry: 'front', kind: 'staff directory' },
    ],
  },
  {
    name: 'Vela Bioworks',
    short: 'VELA',
    domain: 'vela-bioworks.example',
    sector: 'Biotechnology research',
    color: '#b8f0d0',
    style: 'lab',
    headline: 'Small discoveries.\nExtraordinary futures.',
    subline: 'A new chapter in living materials.',
    account: 'research.director',
    vendor: 'Helix Instruments',
    datasets: [
      'trial-results.csv',
      'compound-library.sdf',
      'research-patents.zip',
    ],
    services: ['Lab notebook', 'Sample registry', 'Research vault'],
    endpoints: [
      { path: '/research', entry: 'front', kind: 'publication index' },
      { path: '/scientists/login', entry: 'front', kind: 'identity' },
      { path: '/assays/v1', entry: 'side', kind: 'legacy service' },
      { path: '/instruments/sync', entry: 'dock', kind: 'vendor trust' },
      { path: '/lab-gateway', entry: 'vent', kind: 'edge service' },
      { path: '/samples/resolve', entry: 'sewer', kind: 'undocumented' },
      { path: '/papers/archive', entry: 'side', kind: 'document store' },
      { path: '/people', entry: 'front', kind: 'staff directory' },
    ],
  },
  {
    name: 'Afterhours Assembly',
    short: 'AFTERHOURS',
    domain: 'afterhours-assembly.example',
    sector: 'Culture & live events',
    color: '#f6a5ca',
    style: 'culture',
    headline: 'MAKE ROOM\nFOR THE UNEXPECTED.',
    subline: 'An independent program of sound, space, and possibility.',
    account: 'program.director',
    vendor: 'Stagecraft Ticketing',
    datasets: [
      'member-passports.csv',
      'artist-contracts.zip',
      'unreleased-programs.pdf',
    ],
    services: ['Ticket desk', 'Member directory', 'Artist archive'],
    endpoints: [
      { path: '/whats-on', entry: 'front', kind: 'event index' },
      { path: '/members/sign-in', entry: 'front', kind: 'identity' },
      { path: '/boxoffice/v1', entry: 'side', kind: 'legacy service' },
      { path: '/ticketing/connect', entry: 'dock', kind: 'vendor trust' },
      { path: '/venue-gateway', entry: 'vent', kind: 'edge service' },
      { path: '/passes/resolve', entry: 'sewer', kind: 'undocumented' },
      { path: '/artists', entry: 'side', kind: 'public directory' },
      { path: '/press', entry: 'front', kind: 'document index' },
    ],
  },
  {
    name: 'Tidal Grid',
    short: 'TIDAL',
    domain: 'tidal-grid.example',
    sector: 'Clean energy network',
    color: '#d1f57c',
    style: 'energy',
    headline: 'A BETTER CURRENT.',
    subline: 'Independent energy. Connected communities.',
    account: 'grid.operator',
    vendor: 'Northline Meters',
    datasets: [
      'grid-topology.geojson',
      'customer-meters.parquet',
      'dispatch-keys.archive',
    ],
    services: ['Grid console', 'Meter directory', 'Dispatch vault'],
    endpoints: [
      { path: '/network', entry: 'front', kind: 'coverage map' },
      { path: '/operators/login', entry: 'front', kind: 'identity' },
      { path: '/meters/v1', entry: 'side', kind: 'legacy API' },
      { path: '/installers/update', entry: 'dock', kind: 'vendor trust' },
      { path: '/station-gateway', entry: 'vent', kind: 'edge service' },
      { path: '/dispatch/resolve', entry: 'sewer', kind: 'undocumented' },
      { path: '/outages', entry: 'side', kind: 'status service' },
      { path: '/community', entry: 'front', kind: 'public index' },
    ],
  },
  {
    name: 'Meridian Cooperative',
    short: 'MERIDIAN',
    domain: 'meridian-coop.example',
    sector: 'Member-owned finance',
    color: '#9ebaff',
    style: 'finance',
    headline: 'OWN YOUR\nTOMORROW.',
    subline: 'A financial home built around its members.',
    account: 'treasury.manager',
    vendor: 'Ledgerbridge Clearing',
    datasets: [
      'member-ledger.db',
      'treasury-positions.csv',
      'identity-documents.zip',
    ],
    services: ['Member portal', 'Identity directory', 'Treasury vault'],
    endpoints: [
      { path: '/membership', entry: 'front', kind: 'public index' },
      { path: '/member/sign-in', entry: 'front', kind: 'identity' },
      { path: '/clearing/v1', entry: 'side', kind: 'legacy service' },
      { path: '/partners/settle', entry: 'dock', kind: 'vendor trust' },
      { path: '/branch-gateway', entry: 'vent', kind: 'edge service' },
      { path: '/ledger/resolve', entry: 'sewer', kind: 'undocumented' },
      { path: '/rates', entry: 'side', kind: 'public API' },
      { path: '/team', entry: 'front', kind: 'staff directory' },
    ],
  },
  {
    name: 'Forma Habitat',
    short: 'FORMA',
    domain: 'forma-habitat.example',
    sector: 'Architecture & urban design',
    color: '#ffc89b',
    style: 'studio',
    headline: 'SPACES\nWITH A FUTURE.',
    subline: 'Architecture at the intersection of people and place.',
    account: 'studio.principal',
    vendor: 'Fabricate BIM Cloud',
    datasets: [
      'unbuilt-projects.ifc',
      'client-contracts.zip',
      'site-access-plans.pdf',
    ],
    services: ['Project workspace', 'Studio directory', 'Design archive'],
    endpoints: [
      { path: '/selected-work', entry: 'front', kind: 'project index' },
      { path: '/studio/sign-in', entry: 'front', kind: 'identity' },
      { path: '/drawings/v1', entry: 'side', kind: 'legacy service' },
      { path: '/fabricators/sync', entry: 'dock', kind: 'vendor trust' },
      { path: '/site-gateway', entry: 'vent', kind: 'edge service' },
      { path: '/models/resolve', entry: 'sewer', kind: 'undocumented' },
      { path: '/materials', entry: 'side', kind: 'catalog API' },
      { path: '/practice', entry: 'front', kind: 'staff directory' },
    ],
  },
];

export const targetAt = (index: number): Target =>
  TARGETS[((index % TARGETS.length) + TARGETS.length) % TARGETS.length];
/** A randomly offset, full-cycle deck. Every visit is different until all six have appeared. */
export function targetDeck(start: number): () => number {
  let cursor = Math.floor(start);
  return () => ((cursor++ % TARGETS.length) + TARGETS.length) % TARGETS.length;
}
