// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CRAFT TEXTURE LIBRARY — preset-based textures for crafted primitives
// ─═̷─═̷─ॐ─═̷─═̷─ Stone, wood, metal, grass — all through a preset ID ─═̷─═̷─ॐ─═̷─═̷─
//
// Agents (Merlin, Hermes, craft UI) reference textures by preset ID.
// No raw URLs — safe for remote agents, consistent tiling behavior.
//
// Auto-tiling: if no explicit textureRepeat, repeat is computed from
// the object's world-space dimensions and the preset's naturalSizeMeters.
// A 10m wall with stone (naturalSize 2m) → repeat 5.
//
// Textures sourced from:
//   /public/ground/  — 19 Poly Haven CC0 1K diffuse textures
//   /public/models/kenney-medieval/Textures/  — 10 low-poly 64px
//   /public/models/kenney-urban/Textures/  — 22 low-poly 64px
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export interface CraftTexturePreset {
  id: string
  name: string
  texturePath: string
  fallbackColor: string
  /** World units per texture tile. Auto-repeat = maxDim / naturalSizeMeters. */
  naturalSizeMeters: number
  category: 'stone' | 'wood' | 'metal' | 'nature' | 'urban' | 'snow' | 'lowpoly' | 'brick' | 'tile' | 'roof'
  /** Informational: '1k' = 1024×1024, '128' = 128×128, '64' = 64×64 */
  resolution: '1k' | '128' | '64'
  /** What it suits, for the agents who craft (the craft prompt and get_craft_guide show it). */
  use?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// HIGH-RES PRESETS — Poly Haven 1K diffuse textures (/public/ground/)
// ═══════════════════════════════════════════════════════════════════════════

const HIRES_PRESETS: CraftTexturePreset[] = [
  { id: 'stone',        name: 'Mossy Stone',     texturePath: '/ground/rock_pitted_mossy_diff_1k.webp',     fallbackColor: '#666666', naturalSizeMeters: 2,   category: 'stone',  resolution: '1k' },
  { id: 'cobblestone',  name: 'Cobblestone',     texturePath: '/ground/cobblestone_floor_13_diff_1k.webp',  fallbackColor: '#888888', naturalSizeMeters: 1,   category: 'stone',  resolution: '1k' },
  { id: 'marble',       name: 'Marble',          texturePath: '/ground/marble_01_diff_1k.webp',            fallbackColor: '#e0d8cc', naturalSizeMeters: 2,   category: 'stone',  resolution: '1k' },
  { id: 'concrete',     name: 'Concrete',        texturePath: '/ground/concrete_floor_02_diff_1k.webp',    fallbackColor: '#aaaaaa', naturalSizeMeters: 2,   category: 'urban',  resolution: '1k' },
  { id: 'rock',         name: 'Rock Face',       texturePath: '/ground/rock_face_diff_1k.webp',            fallbackColor: '#4a4a4a', naturalSizeMeters: 2,   category: 'stone',  resolution: '1k' },
  { id: 'grass',        name: 'Grass & Rock',    texturePath: '/ground/aerial_grass_rock_diff_1k.webp',    fallbackColor: '#2d5a1e', naturalSizeMeters: 2,   category: 'nature', resolution: '1k' },
  { id: 'sand',         name: 'Coastal Sand',    texturePath: '/ground/coast_sand_rocks_02_diff_1k.jpg',  fallbackColor: '#c2b280', naturalSizeMeters: 2,   category: 'nature', resolution: '1k' },
  { id: 'dirt',         name: 'Mud & Leaves',    texturePath: '/ground/brown_mud_leaves_01_diff_1k.webp',  fallbackColor: '#6b4e31', naturalSizeMeters: 1.5, category: 'nature', resolution: '1k' },
  { id: 'snow',         name: 'Snow Field',      texturePath: '/ground/snow_field_aerial_diff_1k.webp',    fallbackColor: '#e8e8f0', naturalSizeMeters: 2,   category: 'snow',   resolution: '1k' },
  { id: 'metal',        name: 'Metal Plate',     texturePath: '/ground/metal_plate_diff_1k.webp',          fallbackColor: '#555555', naturalSizeMeters: 1,   category: 'metal',  resolution: '1k' },
  { id: 'gravel',       name: 'Gravelly Sand',   texturePath: '/ground/gravelly_sand_diff_1k.jpg',        fallbackColor: '#b8a882', naturalSizeMeters: 1.5, category: 'nature', resolution: '1k' },
  { id: 'forest-floor', name: 'Forest Floor',    texturePath: '/ground/forest_ground_04_diff_1k.webp',     fallbackColor: '#3a2f1e', naturalSizeMeters: 2,   category: 'nature', resolution: '1k' },
]

// ═══════════════════════════════════════════════════════════════════════════
// LOW-POLY PRESETS — Kenney 64px textures (charming stylized look)
// ═══════════════════════════════════════════════════════════════════════════

const LOWPOLY_PRESETS: CraftTexturePreset[] = [
  { id: 'kn-planks',      name: 'Wood Planks',      texturePath: '/models/kenney-medieval/Textures/planks.png',               fallbackColor: '#8B4513', naturalSizeMeters: 1,   category: 'wood',    resolution: '64' },
  { id: 'kn-cobblestone', name: 'Cobblestone (LP)',  texturePath: '/models/kenney-medieval/Textures/cobblestone.png',          fallbackColor: '#888888', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-roof',        name: 'Roof Tiles',       texturePath: '/models/kenney-medieval/Textures/roof.png',                 fallbackColor: '#8B3A3A', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-barrel',      name: 'Barrel',           texturePath: '/models/kenney-medieval/Textures/barrel.png',               fallbackColor: '#6b4e31', naturalSizeMeters: 0.5, category: 'wood',    resolution: '64' },
  { id: 'kn-fence',       name: 'Fence',            texturePath: '/models/kenney-medieval/Textures/fence.png',                fallbackColor: '#8B6914', naturalSizeMeters: 1,   category: 'wood',    resolution: '64' },
  { id: 'kn-wall',        name: 'Wall',             texturePath: '/models/kenney-urban/Textures/wall.png',                    fallbackColor: '#aaaaaa', naturalSizeMeters: 2,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-asphalt',     name: 'Asphalt',          texturePath: '/models/kenney-urban/Textures/asphalt.png',                 fallbackColor: '#444444', naturalSizeMeters: 2,   category: 'urban',   resolution: '64' },
  { id: 'kn-concrete',    name: 'Concrete (LP)',     texturePath: '/models/kenney-urban/Textures/concrete.png',               fallbackColor: '#999999', naturalSizeMeters: 2,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-dirt',        name: 'Dirt (LP)',         texturePath: '/models/kenney-urban/Textures/dirt.png',                    fallbackColor: '#6b4e31', naturalSizeMeters: 1.5, category: 'lowpoly', resolution: '64' },
  { id: 'kn-grass',       name: 'Grass (LP)',        texturePath: '/models/kenney-urban/Textures/grass.png',                  fallbackColor: '#2d5a1e', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-metal',       name: 'Metal (LP)',        texturePath: '/models/kenney-urban/Textures/metal.png',                  fallbackColor: '#777777', naturalSizeMeters: 1,   category: 'metal',   resolution: '64' },
  { id: 'kn-rock',        name: 'Rock (LP)',         texturePath: '/models/kenney-urban/Textures/rock.png',                   fallbackColor: '#666666', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
]

// ═══════════════════════════════════════════════════════════════════════════
// FURNISHING PRESETS — walls, floors, furniture, roofs, metal: 128px tiles from the ground library
// (public/ground/sbs1, sbs2; the owner, 26 Nov: "another batch like tiles, stone, chessboard... could enrich our
// crafted objects"). Names are the ground library's own.
// ═══════════════════════════════════════════════════════════════════════════

const FURNISHING_PRESETS: CraftTexturePreset[] = [
  { id: 'red-bricks', name: 'Red Bricks', texturePath: '/ground/sbs1/Bricks/Bricks_22-128x128.png', fallbackColor: '#866858', naturalSizeMeters: 1, category: 'brick', resolution: '128', use: 'red brick wall (houses, chimneys)' },
  { id: 'grey-stone-bricks', name: 'Grey Stone Bricks', texturePath: '/ground/sbs1/Bricks/Bricks_17-128x128.png', fallbackColor: '#666464', naturalSizeMeters: 1, category: 'brick', resolution: '128', use: 'grey stone bricks (castles, towers)' },
  { id: 'sandstone-bricks', name: 'Sandstone Bricks', texturePath: '/ground/sbs1/Bricks/Bricks_13-128x128.png', fallbackColor: '#7d603f', naturalSizeMeters: 1, category: 'brick', resolution: '128', use: 'sandstone bricks (desert buildings, temples)' },
  { id: 'mossy-bricks', name: 'Mossy Stone Bricks', texturePath: '/ground/sbs1/Bricks/Bricks_21-128x128.png', fallbackColor: '#564c34', naturalSizeMeters: 1, category: 'brick', resolution: '128', use: 'mossy stone bricks (ruins, old walls)' },
  { id: 'pastel-bricks', name: 'Pastel Bricks', texturePath: '/ground/sbs1/Bricks/Bricks_05-128x128.png', fallbackColor: '#9f8f84', naturalSizeMeters: 1, category: 'brick', resolution: '128', use: 'pastel bricks (cottages, cheerful walls)' },
  { id: 'grey-stone-blocks', name: 'Large Grey Stone Blocks', texturePath: '/ground/sbs2/Brick/Brick_07-128x128.png', fallbackColor: '#7f7f7e', naturalSizeMeters: 2, category: 'brick', resolution: '128', use: 'large grey stone blocks (fortress walls, foundations)' },
  { id: 'slate', name: 'Dark Slate', texturePath: '/ground/sbs1/Bricks/Bricks_16-128x128.png', fallbackColor: '#45474d', naturalSizeMeters: 1, category: 'stone', resolution: '128', use: 'dark slate (cladding, dark walls)' },
  { id: 'pink-stucco', name: 'Tan Stucco', texturePath: '/ground/sbs2/Stone/Stone_04-128x128.png', fallbackColor: '#c8b994', naturalSizeMeters: 2, category: 'stone', resolution: '128', use: 'pink stucco (plastered walls)' },
  { id: 'tan-stucco', name: 'Tan Stucco', texturePath: '/ground/sbs2/Stone/Stone_04-128x128.png', fallbackColor: '#c8b994', naturalSizeMeters: 2, category: 'stone', resolution: '128', use: 'tan stucco (plastered walls)' },
  { id: 'plaster', name: 'Light Grey Plaster', texturePath: '/ground/sbs2/Stone/Stone_07-128x128.png', fallbackColor: '#b3b3b3', naturalSizeMeters: 2, category: 'stone', resolution: '128', use: 'light grey plaster (interior walls)' },
  { id: 'checkerboard', name: 'Checkerboard', texturePath: '/ground/sbs1/Tile/Tile_11-128x128.png', fallbackColor: '#7f7a72', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'black and white checkerboard floor (chess, diners, halls)' },
  { id: 'marble-checkerboard', name: 'Black and White Marble Checkerboard', texturePath: '/ground/sbs1/Tile/Tile_13-128x128.png', fallbackColor: '#949392', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'black and white marble checkerboard (palace floors)' },
  { id: 'cream-marble-tiles', name: 'Cream Marble Tiles', texturePath: '/ground/sbs1/Tile/Tile_05-128x128.png', fallbackColor: '#f5e8be', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'cream marble tiles (bathrooms, halls)' },
  { id: 'white-marble', name: 'White Marble', texturePath: '/ground/sbs1/Tile/Tile_09-128x128.png', fallbackColor: '#e5e3e8', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'white marble (temples, counters)' },
  { id: 'blue-white-tiles', name: 'Blue-Trimmed Tiles, Small', texturePath: '/ground/sbs1/Tile/Tile_04-128x128.png', fallbackColor: '#bfbab6', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'white tiles with blue trim (kitchens, bathrooms)' },
  { id: 'herringbone-pavers', name: 'Red Herringbone Pavers', texturePath: '/ground/sbs2/Tile/Tile_17-128x128.png', fallbackColor: '#b37d68', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'red herringbone pavers (terraces, paths)' },
  { id: 'hexagon-tiles', name: 'Grey Hexagons', texturePath: '/ground/sbs2/Tile/Tile_01-128x128.png', fallbackColor: '#646963', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'grey hexagon tiles (sci-fi and modern floors)' },
  { id: 'flagstones', name: 'Yellow Flagstones', texturePath: '/ground/sbs1/Tile/Tile_08-128x128.png', fallbackColor: '#e1cb85', naturalSizeMeters: 1.5, category: 'tile', resolution: '128', use: 'yellow flagstones (courtyards, garden paths)' },
  { id: 'grey-cobblestone', name: 'Grey Cobblestone', texturePath: '/ground/sbs1/Tile/Tile_17-128x128.png', fallbackColor: '#928872', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'grey cobblestone (streets)' },
  { id: 'ornate-tiles', name: 'Ornate Brown Tiles', texturePath: '/ground/sbs1/Tile/Tile_14-128x128.png', fallbackColor: '#876947', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'ornate brown tiles (rugs, palace floors)' },
  { id: 'mosaic', name: 'Mosaic Stone Arches', texturePath: '/ground/sbs1/Tile/Tile_24-128x128.png', fallbackColor: '#858a8a', naturalSizeMeters: 2, category: 'tile', resolution: '128', use: 'stone mosaic (fountains, plazas)' },
  { id: 'octagon-tiles', name: 'Yellow and Grey Octagons', texturePath: '/ground/sbs1/Tile/Tile_21-128x128.png', fallbackColor: '#8d856f', naturalSizeMeters: 1, category: 'tile', resolution: '128', use: 'yellow and grey octagon tiles (lobbies)' },
  { id: 'mahogany', name: 'Mahogany', texturePath: '/ground/sbs1/Wood/Wood_09-128x128.png', fallbackColor: '#4e2a1f', naturalSizeMeters: 1, category: 'wood', resolution: '128', use: 'mahogany (desks, cabinets, fine furniture)' },
  { id: 'cherry-wood', name: 'Cherry Wood', texturePath: '/ground/sbs1/Wood/Wood_15-128x128.png', fallbackColor: '#5c1f0a', naturalSizeMeters: 1, category: 'wood', resolution: '128', use: 'cherry wood (tables, chairs)' },
  { id: 'pine', name: 'Pine', texturePath: '/ground/sbs1/Wood/Wood_14-128x128.png', fallbackColor: '#dc8b39', naturalSizeMeters: 1, category: 'wood', resolution: '128', use: 'pine (light furniture, shelves)' },
  { id: 'oak', name: 'Golden Oak', texturePath: '/ground/sbs1/Wood/Wood_23-128x128.png', fallbackColor: '#7d590b', naturalSizeMeters: 1, category: 'wood', resolution: '128', use: 'golden oak (floors, tables)' },
  { id: 'weathered-planks', name: 'Weathered Grey Planks', texturePath: '/ground/sbs1/Wood/Wood_18-128x128.png', fallbackColor: '#a89d8a', naturalSizeMeters: 1, category: 'wood', resolution: '128', use: 'weathered grey planks (docks, barns, fences)' },
  { id: 'pale-planks', name: 'Pale Wood Planks', texturePath: '/ground/sbs1/Wood/Wood_01-128x128.png', fallbackColor: '#ae8361', naturalSizeMeters: 1, category: 'wood', resolution: '128', use: 'pale wood planks (floors, crates)' },
  { id: 'dark-wood', name: 'Dark Brown Wood', texturePath: '/ground/sbs1/Wood/Wood_25-128x128.png', fallbackColor: '#5e3820', naturalSizeMeters: 1, category: 'wood', resolution: '128', use: 'dark brown wood (doors, beams)' },
  { id: 'terracotta-roof', name: 'Terracotta Roof Tiles', texturePath: '/ground/sbs1/Roofs/Roofs_05-128x128.png', fallbackColor: '#d17d50', naturalSizeMeters: 1, category: 'roof', resolution: '128', use: 'terracotta roof tiles' },
  { id: 'grey-shingles', name: 'Dark Grey Shingles', texturePath: '/ground/sbs1/Roofs/Roofs_01-128x128.png', fallbackColor: '#2c2825', naturalSizeMeters: 1, category: 'roof', resolution: '128', use: 'dark grey shingles' },
  { id: 'thatch', name: 'Thatch', texturePath: '/ground/sbs1/Roofs/Roofs_02-128x128.png', fallbackColor: '#837c3f', naturalSizeMeters: 1, category: 'roof', resolution: '128', use: 'thatch (huts, cottages)' },
  { id: 'wood-shingles', name: 'Dark Wood Shingles', texturePath: '/ground/sbs1/Roofs/Roofs_16-128x128.png', fallbackColor: '#3c2a23', naturalSizeMeters: 1, category: 'roof', resolution: '128', use: 'dark wood shingles (cabins)' },
  { id: 'corrugated-metal', name: 'Grey Corrugated Metal', texturePath: '/ground/sbs2/Metal/Metal_05-128x128.png', fallbackColor: '#535353', naturalSizeMeters: 1, category: 'metal', resolution: '128', use: 'grey corrugated metal (sheds, hangars)' },
  { id: 'steel-plates', name: 'Brushed Steel Plates', texturePath: '/ground/sbs2/Metal/Metal_15-128x128.png', fallbackColor: '#cdcdcd', naturalSizeMeters: 1, category: 'metal', resolution: '128', use: 'brushed steel plates (sci-fi walls, machines)' },
  { id: 'rusty-metal', name: 'Rusty Metal', texturePath: '/ground/sbs2/Metal/Metal_14-128x128.png', fallbackColor: '#714a29', naturalSizeMeters: 1, category: 'metal', resolution: '128', use: 'rusty metal (wrecks, old machines)' },
]

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const CRAFT_TEXTURE_PRESETS: CraftTexturePreset[] = [...HIRES_PRESETS, ...LOWPOLY_PRESETS, ...FURNISHING_PRESETS]

/** The furnishing batch as prompt lines, e.g. '- "red-bricks" — red brick wall (houses, chimneys)'. */
export function furnishingTextureLines(): string {
  return FURNISHING_PRESETS.map(p => `- "${p.id}" — ${p.use || p.name}`).join('\n')
}

export const CRAFT_TEXTURE_MAP = new Map(CRAFT_TEXTURE_PRESETS.map(p => [p.id, p]))

export function getCraftTexturePreset(id: string): CraftTexturePreset | undefined {
  return CRAFT_TEXTURE_MAP.get(id)
}

/** Shader + text types cannot receive textures. */
const NON_TEXTURABLE_TYPES = new Set([
  'flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora', 'text',
])

export function canHaveTexture(primitiveType: string): boolean {
  return !NON_TEXTURABLE_TYPES.has(primitiveType)
}

/**
 * Auto-calculate texture repeat from object scale + preset's naturalSizeMeters.
 * A 10m wall with stone (naturalSize 2m) → repeat 5.
 * A 1m crate with planks (naturalSize 1m) → repeat 1.
 */
export function computeAutoTiling(
  scale: [number, number, number],
  naturalSizeMeters: number,
): number {
  const maxDim = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]))
  return Math.max(1, Math.round(maxDim / naturalSizeMeters))
}
