/**
 * Regression: when two tables are linked by more than one foreign key
 * (shifts.branch_id and branches.default_shift_id), a Supabase select that
 * embeds one in the other without naming the key is ambiguous: PostgREST
 * returns an error and the page shows an empty list. Every such embed in
 * src/ must name its key, e.g. branches!shifts_branch_id_fkey(name).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "./harness";

let ambiguous = new Set<string>();

beforeAll(async () => {
  const db = await createDb();
  const r = await db.query<{ a: string; b: string }>(`
    with fk as (select c.conrelid::regclass::text s, c.confrelid::regclass::text d from pg_constraint c
                where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confrelid::regclass::text not like 'auth.%')
    select least(s, d) a, greatest(s, d) b from fk where s <> d group by 1, 2 having count(*) > 1`);
  ambiguous = new Set(r.rows.map((x) => `${x.a}|${x.b}`));
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("Supabase embedded selects", () => {
  it("name the foreign key wherever two tables are linked more than once", () => {
    const problems: string[] = [];
    for (const file of files(join(__dirname, "..", "..", "src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/from\("(\w+)"\)\s*\.select\(\s*["'`]([^"'`]*)["'`]/g)) {
        const [, table, select] = m;
        for (const e of select.matchAll(/\b(\w+)(!\w+)?\s*\(/g)) {
          const [, target, hint] = e;
          const key = [table, target].sort().join("|");
          if (ambiguous.has(key) && (!hint || hint === "!inner")) problems.push(`${file.split("/src/")[1]}: ${table} -> ${target}(`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
