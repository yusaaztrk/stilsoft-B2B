/**
 * Yetki senaryo testleri için tek kullanımlık kullanıcılar oluşturur.
 *
 * Gerçek kullanıcıların şifresi bilinmediği ve tahmin edilmemesi gerektiği için test kendi
 * hesaplarını üretir. Hepsi `qatest_` önekli; `tests/temizle.js` bunları siler.
 *
 * Şifre: ServiceOps `VerifyPassword` SHA256 + Base64 karşılaştırması yapıyor.
 */
const { Client } = require('pg')
const crypto = require('crypto')

const TENANT_DB = process.env.TEST_DB || 'b2b_serviceops_tenant_DEMOTEST'
const TENANT = process.env.TEST_TENANT || 'DEMOTEST'
const PASSWORD = 'QaTest!2026'

function hash(pw) {
  return crypto.createHash('sha256').update(pw, 'utf8').digest('base64')
}

const USERS = [
  { username: 'qatest_tech_a', role: 'Technician', technicianName: 'QA Teknisyen A' },
  { username: 'qatest_tech_b', role: 'Technician', technicianName: 'QA Teknisyen B' },
  { username: 'qatest_bayi', role: 'User', dealerCode: null }, // cari kodu aşağıda atanır
]

async function main() {
  const d = new Client({ host: 'localhost', port: 5434, user: 'b2b', password: 'b2b', database: TENANT_DB })
  await d.connect()

  const pwHash = hash(PASSWORD)
  const created = {}

  for (const u of USERS) {
    let technicianId = null

    if (u.technicianName) {
      const existing = await d.query(`SELECT "Id" FROM "Technicians" WHERE "UserId" = $1`, [u.username])
      if (existing.rows.length) {
        technicianId = existing.rows[0].Id
      } else {
        // FullName yok — ad/soyad ayrı kolonlarda, DTO'da birleştiriliyor.
        const res = await d.query(
          `INSERT INTO "Technicians"
             ("Id","EmployeeNumber","FirstName","LastName","Phone","Status",
              "ExpertiseAreas","Specializations","WorkStartTime","WorkEndTime",
              "MaxDailyTasks","Rating","CompletedTasks","TotalTasks","IsActive","CreatedAt",
              "UserId","TenantCode")
           VALUES (gen_random_uuid(),$1,'QA',$2,'05330000000',0,
                   ARRAY[]::text[], ARRAY[]::text[], '08:00'::interval, '18:00'::interval,
                   10, 0, 0, 0, true, NOW(), $3, $4)
           RETURNING "Id"`,
          [`QA-${u.username.slice(-1).toUpperCase()}`, u.technicianName.split(' ').pop(), u.username, TENANT]
        )
        technicianId = res.rows[0].Id
      }
    }

    await d.query(
      `INSERT INTO "ServiceUsers" ("Id","Username","PasswordHash","Role","IsActive","TenantCode","TechnicianId","DealerCode","CreatedAt")
       VALUES (gen_random_uuid(),$1,$2,$3,true,$4,$5,$6,NOW())
       ON CONFLICT ("Username") DO UPDATE
         SET "PasswordHash"=EXCLUDED."PasswordHash", "Role"=EXCLUDED."Role", "IsActive"=true,
             "TenantCode"=EXCLUDED."TenantCode", "TechnicianId"=EXCLUDED."TechnicianId",
             "DealerCode"=EXCLUDED."DealerCode"`,
      [u.username, pwHash, u.role, TENANT, technicianId, u.dealerCode]
    )

    created[u.username] = { technicianId, role: u.role }
  }

  // Bayi kullanıcısına gerçek bir cari kodu bağla: kapsam testinin anlamlı olması için
  // o cariye ait en az bir servis kaydı olmalı.
  const anyDealer = await d.query(
    `SELECT "DealerCode" FROM "ServiceRecords" WHERE "DealerCode" IS NOT NULL AND "DealerCode" <> '' LIMIT 1`
  )
  const dealerCode = anyDealer.rows[0]?.DealerCode ?? null
  if (dealerCode) {
    await d.query(`UPDATE "ServiceUsers" SET "DealerCode" = $1 WHERE "Username" = 'qatest_bayi'`, [dealerCode])
    created['qatest_bayi'].dealerCode = dealerCode
  }

  console.log(JSON.stringify({ password: PASSWORD, tenant: TENANT, users: created }, null, 2))
  await d.end()
}

main().catch(e => { console.error(e); process.exit(1) })
