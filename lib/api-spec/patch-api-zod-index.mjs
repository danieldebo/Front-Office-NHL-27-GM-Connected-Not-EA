/**
 * Post-codegen patch: Orval appends barrel re-exports to lib/api-zod/src/index.ts.
 * We replace the file with an explicit type-only re-export list that excludes
 * ListGamesParams (and any future collisions) to avoid TS2308.
 *
 * Run: node patch-api-zod-index.mjs  (from lib/api-spec/)
 */
import { writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const typesDir = resolve(root, 'lib/api-zod/src/generated/types');
const indexPath = resolve(root, 'lib/api-zod/src/index.ts');

// Names exported by generated/api.ts as Zod CONSTS that also appear as TS types
// in generated/types/. Exporting these from the types barrel would cause TS2308.
const COLLIDING_NAMES = new Set([
  'ListGamesParams',
  // Add others here if new path+query param operations are introduced.
]);

// Discover type file names (excluding index.ts itself)
const typeFiles = readdirSync(typesDir)
  .filter(f => f.endsWith('.ts') && f !== 'index.ts')
  .map(f => f.replace(/\.ts$/, ''));

// Derive PascalCase export name from camelCase file name
function toPascal(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Collect individual type exports, skipping colliders
const typeExports = [];
for (const file of typeFiles.sort()) {
  const pascal = toPascal(file);
  if (COLLIDING_NAMES.has(pascal)) {
    typeExports.push(
      `// ${pascal} intentionally excluded — collides with Zod const of the same name in generated/api.ts`
    );
    continue;
  }
  typeExports.push(`export type { ${pascal} } from "./generated/types/${file}";`);
}

const content = `// Zod validation schemas — for server-side request/response validation.
export * from "./generated/api";

// TypeScript types — generated interfaces. Exported individually (not via
// \`export * from "./generated/types"\`) to avoid TS2308 ambiguity on names
// that also exist as Zod consts in generated/api (e.g. ListGamesParams).
${typeExports.join('\n')}
`;

writeFileSync(indexPath, content, 'utf8');
console.log(`Patched ${indexPath} (${typeExports.length} type exports)`);
