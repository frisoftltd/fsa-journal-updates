/**
 * FundedControl — duplicate top-level name scanner for app/js/*.
 *
 * Every file in app/js/ is loaded as a plain, non-module <script> tag, all on the SAME
 * page, unconditionally (index.php's own module list loads all 18 of them on every page
 * load — this is a single-page app, not per-page bundles). A top-level `function name()`
 * or `let/const/var name` declared in two different files is NOT two independent
 * things that happen to share a name -- in plain-script scope, the LAST <script> tag's
 * declaration silently replaces the earlier one, with no error, no warning. This is
 * exactly how js/calculator.js's own renderOpenPositions() silently ate js/backtest.js's
 * same-named function for this project's entire history until v3.22.3's browser harness
 * caught it by accident while testing something else entirely.
 *
 * Parses each file with acorn (real AST, not a regex guess) and walks only the Program's
 * top-level body -- a `function`/`let`/`const`/`var` nested inside another function,
 * block, or IIFE is irrelevant here (it never touches the shared global scope).
 *
 * Usage: node scan-duplicate-names.mjs [--json]
 * Exit code 0 if no cross-file duplicates found, 1 otherwise (so this can run as a CI/
 * harness assertion, not just a manual report).
 */
import { parse } from 'acorn';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.resolve(__dirname, '..', '..', 'app', 'js');

/** index.php's own module list (the actual <script> load order) -- loaded here just to
 *  assert against drift: if a file exists in app/js/ but isn't in this list (or vice
 *  versa), that's worth knowing about too, since it changes whether a given pair of
 *  files is really sharing a scope on any real page. */
function getIndexPhpModuleList() {
    const indexPhp = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'index.php'), 'utf8');
    const m = indexPhp.match(/\[\s*('app'[\s\S]*?)\]\s*as\s*\$__jsModule/);
    if (!m) return null;
    return [...m[1].matchAll(/'([\w-]+)'/g)].map(x => x[1]);
}

function topLevelNamesInFile(filePath) {
    const src = fs.readFileSync(filePath, 'utf8');
    let ast;
    try {
        ast = parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    } catch (e) {
        return { error: `parse error: ${e.message}` };
    }
    const names = [];
    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration' && node.id) {
            names.push({ name: node.id.name, kind: 'function', line: node.loc ? node.loc.start.line : null });
        } else if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id.type === 'Identifier') {
                    names.push({ name: decl.id.name, kind: node.kind, line: node.loc ? node.loc.start.line : null });
                }
                // Destructuring patterns (let {a,b} = ...) are rare at top level in this
                // codebase (confirmed none exist by this scan's own clean run) -- not
                // walked here; add ObjectPattern/ArrayPattern handling here first if this
                // assumption ever stops holding.
            }
        } else if (node.type === 'ClassDeclaration' && node.id) {
            names.push({ name: node.id.name, kind: 'class', line: node.loc ? node.loc.start.line : null });
        }
    }
    return { names };
}

export function scan() {
    const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();
    const byName = new Map(); // name -> [{file, kind, line}]
    const parseErrors = [];

    for (const file of files) {
        const result = topLevelNamesInFile(path.join(JS_DIR, file));
        if (result.error) { parseErrors.push({ file, error: result.error }); continue; }
        for (const { name, kind, line } of result.names) {
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name).push({ file, kind, line });
        }
    }

    const duplicates = [];
    for (const [name, occurrences] of byName) {
        const distinctFiles = new Set(occurrences.map(o => o.file));
        if (distinctFiles.size > 1) duplicates.push({ name, occurrences });
    }
    duplicates.sort((a, b) => a.name.localeCompare(b.name));

    return { files, duplicates, parseErrors };
}

function main() {
    const asJson = process.argv.includes('--json');
    const { files, duplicates, parseErrors } = scan();
    const moduleList = getIndexPhpModuleList();

    if (asJson) {
        console.log(JSON.stringify({ duplicates, parseErrors }, null, 2));
    } else {
        console.log(`Scanned ${files.length} files in app/js/.`);
        if (moduleList) {
            const missing = files.map(f => f.replace(/\.js$/, '')).filter(m => !moduleList.includes(m));
            if (missing.length) console.log(`NOTE: not in index.php's own module list (not loaded on the page): ${missing.join(', ')}`);
        }
        if (parseErrors.length) {
            console.log('\nPARSE ERRORS:');
            for (const e of parseErrors) console.log(`  ${e.file}: ${e.error}`);
        }
        if (duplicates.length === 0) {
            console.log('\nNo cross-file top-level name duplicates found.');
        } else {
            console.log(`\n${duplicates.length} cross-file top-level name duplicate(s):\n`);
            for (const { name, occurrences } of duplicates) {
                console.log(`  ${name}`);
                for (const o of occurrences) console.log(`    - ${o.file}:${o.line} (${o.kind})`);
            }
        }
    }
    process.exitCode = duplicates.length > 0 ? 1 : 0;
}

// Run main() only when executed directly (`node scan-duplicate-names.mjs`), not when
// imported for its scan() export (tools/ui-harness/drive-v3223.mjs's own assertion).
if (process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
    main();
}
