import type { ChangedFile } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { fixtureFiles, FIXTURE_PATHS } from './fixture';
import { commonDirPrefix, districtKey, height, layoutCity, MAX_BUILDINGS, PLANE_W, rubble, side, type CityDistrict } from './layoutCity';

function file(path: string, added: number, removed: number, kind: ChangedFile['kind'] = 'modified'): ChangedFile {
  return { path, oldPath: null, kind, added, removed, authorAgentId: null, touchedBy: [], uncommitted: false };
}

const building = (layout: ReturnType<typeof layoutCity>, path: string) => {
  const found = layout.buildings.find((b) => b.path === path);
  if (!found) throw new Error(`no building for ${path}`);
  return found;
};

describe('layoutCity formulas', () => {
  it('derives side, height and rubble from the line counts', () => {
    expect([120, 64, 47, 40, 7].map(side)).toEqual([100, 90, 80, 80, 60]);
    expect([120, 64, 3, 38, 6].map(height)).toEqual([162, 86, 14, 51, 14]);
    expect(height(0)).toBe(0);
    expect(height(500)).toBe(240);
    expect(side(0)).toBe(56);
    expect(side(100000)).toBe(120);
    expect(rubble(44)).toEqual({ w: 127, d: 95 });
    expect(rubble(2)).toEqual({ w: 34, d: 26 });
    expect(rubble(1)).toEqual({ w: 32, d: 24 });
    expect(rubble(1000)).toEqual({ w: 160, d: 120 });
  });

  it('keys a district by the first two directories after the common prefix', () => {
    expect(districtKey('A/B/C/D/x.cs', 'A/')).toBe('B/C');
    expect(districtKey('A/B/x.cs', 'A/')).toBe('B');
    expect(districtKey('A/x.cs', 'A/')).toBe('(root)');
    expect(commonDirPrefix(['A/B/x', 'A/C/y'])).toBe('A/');
    expect(commonDirPrefix(['A/B/x', 'C/y'])).toBe('');
  });
});

describe('layoutCity golden case (the handoff worked example)', () => {
  const layout = layoutCity(fixtureFiles);

  it('sizes every building as the worked-example table says', () => {
    const table: [string, number, number, { w: number; d: number } | null][] = [
      [FIXTURE_PATHS.razor, 100, 162, null],
      [FIXTURE_PATHS.tests, 90, 86, null],
      [FIXTURE_PATHS.legacy, 80, 14, { w: 127, d: 95 }],
      [FIXTURE_PATHS.razorCs, 80, 51, { w: 34, d: 26 }],
      [FIXTURE_PATHS.formatter, 60, 14, { w: 32, d: 24 }],
    ];
    for (const [path, sideLength, buildingHeight, tile] of table) {
      const b = building(layout, path);
      expect(b.side, path).toBe(sideLength);
      expect(b.height, path).toBe(buildingHeight);
      if (tile) expect(b.rubble).toMatchObject(tile);
      else expect(b.rubble).toBeUndefined();
    }
  });

  it('names and orders the districts by total lines, then name', () => {
    expect(layout.districts.map((d) => d.key)).toEqual([
      'ComponentLibrary/Pages',
      'Tests/Companion',
      'Legacy.WinExe/OfflineSynchronisation',
      'ComponentLibrary/Components',
    ]);
    expect(layout.districts.map((d) => d.label)).toEqual([
      'ComponentLibrary / Pages',
      'Tests / Companion',
      'Legacy.WinExe / OfflineSynchronisation',
      'ComponentLibrary / Components',
    ]);
  });

  it('orders buildings in reading order: district, then size', () => {
    expect(layout.buildings.map((b) => b.name)).toEqual([
      'FailedSyncFiles.razor',
      'FailedSyncFiles.razor.cs',
      'FailedSyncFilesTests.cs',
      'frmFailedFiles.vb',
      'CompanionGridFormatter.cs',
    ]);
  });

  it('puts rubble 12px after its building and wraps rows at 300px', () => {
    const cs = building(layout, FIXTURE_PATHS.razorCs);
    expect(cs.rubble?.x).toBe(cs.x + cs.side + 12);
    expect(cs.rubble?.y).toBe(cs.y);
    // Pages row: 100 + 30 + (80 + 12 + 34) = 256 wide, so both files share one row.
    expect(cs.y).toBe(building(layout, FIXTURE_PATHS.razor).y);
    expect(cs.x - building(layout, FIXTURE_PATHS.razor).x).toBe(130);
  });

  it('wraps a district plate: rows + PAD on three sides, LABEL at the front', () => {
    const pages = layout.districts[0]!;
    expect(pages).toMatchObject({ x: 0, y: 0, w: 256 + 60, d: 30 + 100 + 40 });
    const legacy = layout.districts[2]!;
    expect(legacy.w).toBe(80 + 12 + 127 + 60);
    expect(legacy.d).toBe(30 + 95 + 40);
  });

  it('shelf-packs plates left to right within 880px, then wraps', () => {
    const [pages, tests, legacy, components] = layout.districts as [CityDistrict, CityDistrict, CityDistrict, CityDistrict];
    expect(tests.x).toBe(pages.x + pages.w + 30);
    expect(legacy.x).toBe(tests.x + tests.w + 30);
    expect(legacy.x + legacy.w).toBeLessThanOrEqual(PLANE_W);
    expect(components.x).toBe(0);
    expect(components.y).toBe(pages.d + 30);
    expect(layout.width).toBe(legacy.x + legacy.w);
    expect(layout.depth).toBe(components.y + components.d);
    expect(layout.overflow).toBe(0);
    expect(layout.overflowPlot).toBeNull();
  });
});

describe('layoutCity invariants', () => {
  it('is deterministic whatever order the files arrive in', () => {
    const [a, b, c, d, e] = fixtureFiles as [ChangedFile, ChangedFile, ChangedFile, ChangedFile, ChangedFile];
    const shuffled = [d, a, e, c, b];
    expect(layoutCity(shuffled)).toEqual(layoutCity(fixtureFiles));
  });

  it('caps at 40 buildings and counts the rest as overflow', () => {
    const files = Array.from({ length: 55 }, (_, i) => file(`src/area${i % 3}/file${String(i).padStart(2, '0')}.ts`, 10 + i, 0));
    const layout = layoutCity(files);
    expect(layout.buildings).toHaveLength(MAX_BUILDINGS);
    expect(layout.overflow).toBe(15);
    expect(layout.overflowPlot).not.toBeNull();
    // The first 40 in district-then-size order are kept: the biggest file of the busiest district is in.
    expect(layout.buildings.some((b) => b.path.endsWith('file54.ts'))).toBe(true);
    // Nothing leaves the plane and the overflow plot does not overlap a district.
    const plot = layout.overflowPlot!;
    for (const d of layout.districts) {
      const apart = plot.x >= d.x + d.w || plot.x + plot.w <= d.x || plot.y >= d.y + d.d || plot.y + plot.d <= d.y;
      expect(apart).toBe(true);
    }
    expect(layout.width).toBeLessThanOrEqual(PLANE_W);
  });

  it('never overlaps two plates', () => {
    const files = Array.from({ length: 30 }, (_, i) => file(`root/d${i}/sub/f.ts`, 5 + i, i % 4));
    const { districts } = layoutCity(files);
    for (let i = 0; i < districts.length; i++) {
      for (let j = i + 1; j < districts.length; j++) {
        const a = districts[i]!;
        const b = districts[j]!;
        const apart = a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.d || b.y >= a.y + a.d;
        expect(apart, `${a.key} vs ${b.key}`).toBe(true);
      }
    }
  });

  it('a deleted file is rubble only', () => {
    const layout = layoutCity([file('a/gone.cs', 0, 30, 'deleted'), file('a/kept.cs', 10, 0)]);
    const gone = building(layout, 'a/gone.cs');
    expect(gone.height).toBe(0);
    expect(gone.side).toBe(0);
    expect(gone.rubble).toMatchObject({ w: 96, d: 72, x: gone.x, y: gone.y });
  });

  it('a binary file is a 10px slab', () => {
    const slab = building(layoutCity([file('a/logo.png', 0, 0, 'binary'), file('a/b.cs', 5, 0)]), 'a/logo.png');
    expect(slab.height).toBe(10);
    expect(slab.slab).toBe(true);
    expect(slab.rubble).toBeUndefined();
  });

  it('places a renamed file at its new path', () => {
    const renamed: ChangedFile = { ...file('a/new/Name.cs', 3, 3, 'renamed'), oldPath: 'a/old/Name.cs' };
    const layout = layoutCity([renamed, file('a/other.cs', 1, 0)]);
    expect(building(layout, 'a/new/Name.cs').kind).toBe('renamed');
    expect(layout.buildings.find((b) => b.path === 'a/old/Name.cs')).toBeUndefined();
  });

  it('gives a root-level file the (root) district', () => {
    const layout = layoutCity([file('README.md', 4, 0), file('src/a.ts', 9, 0)]);
    expect(layout.districts.map((d) => d.key).sort()).toEqual(['(root)', 'src']);
    expect(building(layout, 'README.md').districtKey).toBe('(root)');
  });

  it('caps a tall building at 240px and flags it above 180 added lines', () => {
    const layout = layoutCity([file('a/big.cs', 400, 0), file('a/ok.cs', 180, 0), file('a/other.cs', 1, 0)]);
    expect(building(layout, 'a/big.cs')).toMatchObject({ height: 240, tall: true });
    expect(building(layout, 'a/ok.cs')).toMatchObject({ height: 240, tall: false });
  });

  it('an empty change set gives an empty plane', () => {
    expect(layoutCity([])).toEqual({ width: 0, depth: 0, districts: [], buildings: [], overflow: 0, overflowPlot: null });
  });

  it('gives a modified file that only removes lines the minimum height', () => {
    const b = building(layoutCity([file('a/x.cs', 0, 12), file('a/y.cs', 1, 0)]), 'a/x.cs');
    expect(b.height).toBe(14);
    expect(b.rubble).toBeDefined();
  });
});
