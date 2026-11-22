/**
 * Optional fallback: load a tiny, fake dataset through the SAME pipeline as the
 * real import, to test the app before (or without) exporting the real sheets.
 *
 *   npx tsx scripts/seed-sample.ts --dry-run
 *   npx tsx scripts/seed-sample.ts           # writes scripts/data/sample/*.csv, then imports
 *   npx tsx scripts/seed-sample.ts --reset   # replace a previous import (sample or real)
 *
 * The sample uses real SKUs, so a later `import-sheets.ts --reset` overwrites
 * it cleanly (products are upserted by SKU; imported rows are replaced).
 */
import fs from "node:fs";
import path from "node:path";

import { buildPlan, findProjectRoot, printReport, writePlan } from "./lib/import-core";

const INVENTARIO = `ID_Producto,Nombre Descriptivo,Dueño,Unidades_por_Bulto,Costo_Bulto,Costo_Unidad,Precio_Sugerido,Precio_Venta,Stock_Inicial,Stock_Actual
REF_NEG,Refresco Negro,Frank,6,"$6,050.00","$1,008.33","$1,310.83","$1,300.00",12,9
REF_UVA,Refresco Uva,Mamá,6,"$4,850.00",$808.33,"$1,050.83","$1,200.00",12,10
REF_KOL,Refresco Kolita (Colita),Anthony,6,"$4,850.00",$808.33,"$1,050.83","$1,200.00",6,5
JUSTY_PER,Justy Pera (Jugo),Javi,12,"$9,600.00",$800.00,"$1,040.00","$1,300.00",12,12
TOM_PEPITO,Pepito,Javi,8,"$4,750.00",$593.75,$771.88,"$1,200.00",8,6
CHUPETA,Chupetas,Javi,24,"$1,662.00",$69.25,$90.03,$200.00,0,-2
`;

const TRANSACCIONES = `z,,,,,,,,,,"$0.00"
ID_Transaccion,Fecha,Tipo_Operacion,ID_Producto,Cantidad,Monto_Operacion,Cliente_Fiado,Dueño,,,Total
1,11/1/2026 9:00:00,Compra Bulto,REF_NEG,12,"$12,100.00",,Frank,,,
2,11/1/2026 10:15:00,Pago movil,REF_NEG,1,"$1,300.00",,Frank,,,
2,11/1/2026 10:15:00,Pago movil,TOM_PEPITO,1,"$1,200.00",,Javi,,,
3,11/1/2026 12:30:00,Efectivo,REF_UVA,2,"$2,400.00",,Mamá,,,
4,11/2/2026 18:45:00,Fiado,REF_KOL,1,"$1,200.00",cliente demo,Anthony,,,
4,11/2/2026 18:45:00,Fiado,CHUPETA,2,$400.00,cliente demo,Javi,,,
5,11/3/2026 19:00:00,Abono Pago movil,REF_KOL,1,"$1,200.00",Cliente Demo,Anthony,,,
6,11/4/2026 8:00:00,--- CICLO ---,Se compró mercancía,,,,,,,
7,11/4/2026 20:00:00,Transferencia,-,0,"$2,500.00",,Frank,,,
8,11/5/2026 9:30:00,Aporte,-,0,"$5,000.00",,Javi,,,
`;

async function main() {
  const args = process.argv.slice(2);
  const dataDir = path.join(findProjectRoot(), "scripts", "data", "sample");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "inventario.csv"), INVENTARIO, "utf8");
  fs.writeFileSync(path.join(dataDir, "transacciones.csv"), TRANSACCIONES, "utf8");
  console.log(`Sample CSVs written to ${dataDir}`);

  const plan = buildPlan(dataDir);
  if (args.includes("--dry-run")) {
    printReport(plan, null, "dry-run");
    return;
  }
  const result = await writePlan(plan, { reset: args.includes("--reset"), rollback: args.includes("--rehearse") });
  printReport(plan, result, "write");
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
