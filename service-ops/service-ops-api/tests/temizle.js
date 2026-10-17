/**
 * Kabul testlerinin ürettiği izleri siler.
 *
 * İki tür iz var:
 *  1. Test servis kayıtları (SNTEST- seri no / "TEST MÜŞTERİ" adı) — bağlı satırlarıyla silinir.
 *  2. Test, hak ediş listesindeki ilk kaydı 90 USD / Onaylandı yapar. Bu GERÇEK bir kayıt
 *     olabilir; bu yüzden 'ssa' tarafından onaylanmış hak edişler bekleyene geri çekilir ve
 *     defter satırları kaldırılır.
 */
const { Client } = require('pg')

const TENANT_DB = process.env.TEST_DB || 'b2b_serviceops_tenant_DEMOTEST'
const d = new Client({ host: 'localhost', port: 5434, user: 'b2b', password: 'b2b', database: TENANT_DB })

;(async () => {
  await d.connect()

  const ids = await d.query(
    `SELECT "Id","ServiceNumber" FROM "ServiceRecords"
     WHERE "SerialNumber" LIKE 'SNTEST-%' OR "CustomerName" LIKE 'TEST MÜŞTERİ%'`
  )
  console.log('Silinecek servis kaydı:', ids.rows.length, ids.rows.map(r => r.ServiceNumber).join(', '))

  if (ids.rows.length) {
    const list = ids.rows.map(r => `'${r.Id}'`).join(',')
    await d.query(`DELETE FROM "TechnicianLedgerEntries" WHERE "SourceId" IN (SELECT "Id" FROM "TechnicianEarnings" WHERE "SourceId" IN (${list}))`)
    await d.query(`DELETE FROM "TechnicianEarnings" WHERE "SourceId" IN (${list})`)
    await d.query(`DELETE FROM "Activities" WHERE "ServiceId" IN (${list})`)
    await d.query(`DELETE FROM "ServiceNotes" WHERE "ServiceId" IN (${list})`)
    await d.query(`DELETE FROM "ServiceRecordItems" WHERE "ServiceId" IN (${list})`)
    await d.query(`DELETE FROM "InstallationTasks" WHERE "ServiceId" IN (${list})`)
    await d.query(`DELETE FROM "WorkOrders" WHERE "ServiceId" IN (${list})`)
    await d.query(`DELETE FROM "ServiceRecords" WHERE "Id" IN (${list})`)
  }

  const pay = await d.query(`DELETE FROM "TechnicianLedgerEntries" WHERE "Description" = 'Otomatik test ödemesi'`)
  console.log('Silinen test ödemesi satırı:', pay.rowCount)

  const approved = await d.query(`SELECT "Id" FROM "TechnicianEarnings" WHERE "ApprovedBy" = 'ssa'`)
  for (const row of approved.rows) {
    await d.query(`DELETE FROM "TechnicianLedgerEntries" WHERE "SourceId" = $1`, [row.Id])
    await d.query(
      `UPDATE "TechnicianEarnings"
          SET "Amount" = 0, "Currency" = 'TRY', "Status" = 0,
              "ApprovedAt" = NULL, "ApprovedBy" = NULL,
              "ExchangeRate" = NULL, "LocalAmount" = NULL, "ExchangeRateDate" = NULL
        WHERE "Id" = $1`,
      [row.Id]
    )
  }
  console.log('Bekleyene çekilen hak ediş:', approved.rows.length)

  const left = await d.query(`SELECT COUNT(*)::int AS n FROM "ServiceRecords"`)
  const ledger = await d.query(`SELECT COUNT(*)::int AS n FROM "TechnicianLedgerEntries"`)
  console.log(`Kalan: ${left.rows[0].n} servis kaydı, ${ledger.rows[0].n} defter satırı`)

  await d.end()
})()
