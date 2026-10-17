/**
 * Kabul testleri (prompt #51). Gerçek API'lere karşı çalışır, mock yok.
 *
 * ServiceOps: http://localhost:5137   B2B ERP: http://localhost:5200
 * Test firması: DEMOTEST
 */
const SVC = 'http://localhost:5137'
const TENANT = process.env.TEST_TENANT || 'DEMOTEST'
const USER = process.env.TEST_USER || 'ssa'
const PASS = process.env.TEST_PASS || '123'

let token = null
const results = []

function log(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  GEÇTİ ' : '  KALDI '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function api(path, options = {}) {
  const res = await fetch(`${SVC}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Tenant-Code': TENANT,
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

/**
 * Oturum, uygulamanın kendi kullandığı yoldan alınır: B2B'de giriş yapılır, ERP token'ı
 * /api/auth/exchange ile ServiceOps token'ına takas edilir. Ham ERP token'ı normal auth
 * hattında geçmez; takas tek kapıdır.
 */
async function login() {
  const erpRes = await fetch('http://localhost:5200/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, tenantCode: '' }),
  })
  const erpBody = await erpRes.json().catch(() => null)
  const erpToken = erpBody?.data?.accessToken
  if (!erpToken) throw new Error(`B2B girişi başarısız (${erpRes.status})`)

  const res = await fetch(`${SVC}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: erpToken, tenantCode: TENANT }),
  })
  const body = await res.json().catch(() => null)
  const t = body?.accessToken ?? body?.data?.accessToken
  if (!res.ok || !t) throw new Error(`Takas başarısız (${res.status}): ${JSON.stringify(body)}`)
  token = t
  return body
}

const createdRecordIds = []

async function main() {
  console.log(`\n=== Kabul Testleri (${TENANT}) ===\n`)

  // --- Oturum ---
  try {
    const me = await login()
    log('Giriş', true, `${me.user?.name} / ${me.user?.role}`)
  } catch (e) {
    log('Giriş', false, e.message)
    return finish()
  }

  const perms = await api('/api/auth/permissions')
  log('Yetki ucu', perms.status === 200, `isSuperAdmin=${perms.body?.isSuperAdmin}`)

  // --- Test 11: Bayiler geliyor mu (#7, Test 11) ---
  const dealers = await api('/api/erp/dealers?type=bayi')
  const dealerItems = dealers.body?.data?.items ?? []
  log('Test 11 — Bayi/cari listesi geliyor', dealers.status === 200 && dealerItems.length > 0,
    `${dealers.status}, ${dealerItems.length} bayi`)

  const sampleDealer = dealerItems[0]
  if (sampleDealer) {
    log('  ↳ fatura tipi çözülüyor', Boolean(sampleDealer.invoiceType),
      `${sampleDealer.customerCode} → ${sampleDealer.invoiceType}`)
  }

  // --- /api/erp/customers ve /api/erp/products çakışmıyor mu (rota çakışması regresyonu) ---
  const customers = await api('/api/erp/customers')
  log('Rota çakışması yok — /api/erp/customers', customers.status === 200,
    `${customers.status}, ${Array.isArray(customers.body) ? customers.body.length : '?'} cari`)

  const products = await api('/api/erp/products?pageSize=5')
  log('Stok/ürün ucu — /api/erp/products', products.status === 200,
    `${products.status}, ${products.body?.data?.items?.length ?? 0} ürün`)

  // --- Bölgeler (montaj/servis kaydı için zorunlu; TenantConnectionStringResolver seed eder) ---
  const regionsRes = await api('/api/regions')
  const regions = Array.isArray(regionsRes.body) ? regionsRes.body : (regionsRes.body?.data ?? [])
  log('Bölge seed edilmiş', regionsRes.status === 200 && regions.length > 0,
    `${regions.length} bölge: ${regions.slice(0, 3).map(r => r.name).join(', ')}`)
  const regionId = regions[0]?.id

  // --- Test 1: Büyük ürün servis kaydı ---
  const bigPayload = {
    regionId,
    customerName: 'TEST MÜŞTERİ BÜYÜK',
    customerPhone: '05330000001',
    customerAddress: 'Girne Merkez',
    productName: 'BUZDOLABI TEST',
    serialNumber: 'SNTEST-BIG-1',
    problemDescription: 'Soğutmuyor (otomatik test)',
    type: 'Repair',
    category: 'large',
    priority: 'Normal',
    dealerName: sampleDealer?.name,
    dealerCode: sampleDealer?.customerCode,
    isUnderWarranty: false,
  }
  const bigCreate = await api('/api/servicerecords', { method: 'POST', body: JSON.stringify(bigPayload) })
  const bigId = bigCreate.body?.id
  if (bigId) createdRecordIds.push(bigId)
  log('Test 1 — Büyük ürün kaydı oluşuyor', bigCreate.status < 300 && Boolean(bigId),
    `${bigCreate.status}, no=${bigCreate.body?.serviceNumber}`)
  log('  ↳ kategori "large"', bigCreate.body?.category === 'large', `category=${bigCreate.body?.category}`)
  log('  ↳ bayi kodu kayda yazıldı', Boolean(bigCreate.body?.dealerCode), `dealerCode=${bigCreate.body?.dealerCode}`)

  // Planlama listesine düşüyor mu
  const planningList = await api('/api/servicerecords/paged?statuses=New,LargeProductPlanning&category=large&pageSize=200&scopeKey=buyukUrun.planlama')
  const inPlanning = (planningList.body?.items ?? []).some(r => r.id === bigId)
  log('  ↳ Büyük Ürün Planlama listesinde', inPlanning, `${planningList.body?.items?.length ?? 0} kayıt`)

  // --- Test 7: Küçük ürün kaydı ---
  const smallCreate = await api('/api/servicerecords', {
    method: 'POST',
    body: JSON.stringify({ ...bigPayload, customerName: 'TEST MÜŞTERİ KÜÇÜK', productName: 'SÜPÜRGE TEST', serialNumber: 'SNTEST-SML-1', category: 'small' }),
  })
  const smallId = smallCreate.body?.id
  if (smallId) createdRecordIds.push(smallId)
  log('Test 7 — Küçük ürün kaydı oluşuyor', smallCreate.status < 300 && Boolean(smallId), `${smallCreate.status}`)
  log('  ↳ kategori "small"', smallCreate.body?.category === 'small', `category=${smallCreate.body?.category}`)

  // Kategori süzgeci tümleyen mi: küçük kayıt büyük listesinde ÇIKMAMALI
  const largeList = await api('/api/servicerecords/paged?category=large&pageSize=500&scopeKey=buyukUrun.planlama')
  const leaked = (largeList.body?.items ?? []).some(r => r.id === smallId)
  log('Kategori süzgeci tümleyen (küçük, büyük listesine sızmıyor)', !leaked)

  const smallList = await api('/api/servicerecords/paged?category=small&pageSize=500&scopeKey=atolyeAriza.atolye')
  const smallFound = (smallList.body?.items ?? []).some(r => r.id === smallId)
  log('  ↳ küçük ürün küçük listesinde', smallFound)

  // --- Teknisyen ---
  const techs = await api('/api/technicians')
  const techList = Array.isArray(techs.body) ? techs.body : []
  const tech = techList[0]
  log('Teknisyen listesi', techs.status === 200 && techList.length > 0, `${techList.length} teknisyen`)

  // --- Test 2: Planlama (saha personeli ataması) ---
  let planOk = false
  if (bigId && tech) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString()
    const plan = await api(`/api/servicerecords/${bigId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plannedDate: tomorrow, technicianId: tech.id, status: 'FieldPlanned' }),
    })
    planOk = plan.status < 300
    log('Test 2 — Servis müdürü saha planı yapıyor', planOk, `${plan.status}, ${tech.fullName}`)

    // Planlanan güne göre süzme (#7 / Test 2)
    const day = tomorrow.slice(0, 10)
    const byPlannedDate = await api(`/api/servicerecords/paged?plannedDate=${day}&category=large&pageSize=200&scopeKey=buyukUrun.sahaPlanlama`)
    const foundByDay = (byPlannedDate.body?.items ?? []).some(r => r.id === bigId)
    log('  ↳ planlanan güne göre süzme çalışıyor', foundByDay, `${day}: ${byPlannedDate.body?.items?.length ?? 0} kayıt`)

    // Oluşturma tarihine göre "bugünden bugüne" süzme boş dönmemeli (gün sonu dahil hatası)
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    const today = now.toISOString().slice(0, 10)
    const byCreated = await api(`/api/servicerecords/paged?dateFrom=${today}&dateTo=${today}&category=large&pageSize=200&scopeKey=buyukUrun.planlama`)
    const foundToday = (byCreated.body?.items ?? []).some(r => r.id === bigId)
    log('  ↳ "bugünden bugüne" süzme bugün açılan kaydı buluyor', foundToday,
      `${byCreated.body?.items?.length ?? 0} kayıt`)
  }

  // --- Test 4: Atölyeye alma — AYNI kayıt, duplicate yok ---
  if (bigId) {
    const before = await api('/api/servicerecords/paged?category=large&pageSize=500&scopeKey=buyukUrun.planlama')
    const countBefore = before.body?.totalCount ?? 0

    const toWorkshop = await api(`/api/servicerecords/${bigId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Workshop', notes: 'Sahada çözülemedi, atölyeye alındı (otomatik test)' }),
    })
    log('Test 4 — Atölyeye Al', toWorkshop.status < 300, `${toWorkshop.status}`)

    const after = await api('/api/servicerecords/paged?category=large&pageSize=500&scopeKey=buyukUrun.planlama');
    const countAfter = after.body?.totalCount ?? 0
    log('  ↳ duplicate servis kaydı oluşmadı', countAfter <= countBefore,
      `önce=${countBefore} sonra=${countAfter}`)

    const rec = await api(`/api/servicerecords/${bigId}`)
    log('  ↳ aynı ServiceId atölyede', rec.body?.status === 'Workshop', `status=${rec.body?.status}`)
  }

  // --- Test 5: Atölye tamamlama → Hazır ---
  if (bigId) {
    const ready = await api(`/api/servicerecords/${bigId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Ready', notes: 'Tamir tamamlandı (otomatik test)' }),
    })
    log('Test 5 — Atölye Hazır', ready.status < 300, `${ready.status}`)
  }

  // --- Servis faturası: idempotency (#46) ---
  if (bigId && sampleDealer) {
    const invoiceBody = {
      customerCode: sampleDealer.customerCode,
      productName: 'BUZDOLABI TEST',
      price: 100,
      serviceRecordId: bigId,
      serviceNumber: bigCreate.body?.serviceNumber,
      sourcePage: 'OtomatikTest',
    }
    const first = await api('/api/erp/invoices/create-service-invoice', { method: 'POST', body: JSON.stringify(invoiceBody) })
    const second = await api('/api/erp/invoices/create-service-invoice', { method: 'POST', body: JSON.stringify(invoiceBody) })

    const firstOk = first.status < 300
    log('Test 3 — Servis faturası oluşuyor', firstOk, `${first.status} ${JSON.stringify(first.body).slice(0, 120)}`)

    const secondSaysExisting = second.status < 300 && second.body?.alreadyInvoiced === true
    log('#46 — İkinci fatura isteği YENİ fatura kesmiyor', secondSaysExisting,
      `${second.status}, alreadyInvoiced=${second.body?.alreadyInvoiced}`)

    const recAfter = await api(`/api/servicerecords/${bigId}`)
    log('  ↳ kayıt faturalandı olarak işaretli', recAfter.body?.isInvoiced === true || Boolean(recAfter.body?.invoiceReference),
      `isInvoiced=${recAfter.body?.isInvoiced} ref=${recAfter.body?.invoiceReference}`)

    // İptal → tekrar faturalanabilir olmalı
    const cancel = await api(`/api/erp/invoices/cancel-service-invoice-by-record/${bigId}`, { method: 'DELETE' })
    log('Fatura iptal ucu yanıt veriyor (404 değil)', cancel.status !== 404, `${cancel.status}`)
    if (cancel.status < 300) {
      const recCancelled = await api(`/api/servicerecords/${bigId}`)
      log('  ↳ iptal sonrası faturalandı işareti kalktı', recCancelled.body?.isInvoiced !== true,
        `isInvoiced=${recCancelled.body?.isInvoiced}`)
    }
  }

  // --- Test 8: Hak ediş + Personel Ekstresi ---
  const sync = await api('/api/earnings/sync', { method: 'POST' })
  log('Test 8 — Hak ediş senkronizasyonu', sync.status === 200, `${sync.status}, ${sync.body?.created} yeni`)

  const earnings = await api('/api/earnings')
  const earningList = earnings.body?.data ?? []
  log('  ↳ Hakediş listesi ucu', earnings.status === 200, `${earnings.status}, ${earningList.length} kayıt`)

  const target = earningList[0]
  if (target) {
    const approve = await api(`/api/earnings/${target.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Approved', amount: 90, currency: 'USD' }),
    })
    log('  ↳ 90 USD hak ediş tanımlandı', approve.status === 200, `${approve.status}`)

    const ledger = await api(`/api/earnings/ledger?technicianId=${target.technicianId}`)
    const rows = ledger.body?.data ?? []
    const usdRow = rows.find(r => r.currency === 'USD' && Number(r.credit) === 90)
    log('  ↳ Personel Ekstresinde 90 USD hareket', Boolean(usdRow),
      `${rows.length} hareket, bakiyeler=${JSON.stringify(ledger.body?.balances ?? [])}`)
    log('  ↳ döviz orijinal tutarıyla korunuyor (TL\'ye çevrilmemiş)',
      usdRow ? Number(usdRow.credit) === 90 && usdRow.currency === 'USD' : false)

    // Aynı hak edişi ikinci kez onaylamak ikinci satır üretmemeli
    await api(`/api/earnings/${target.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Approved', amount: 90, currency: 'USD' }),
    })
    const ledger2 = await api(`/api/earnings/ledger?technicianId=${target.technicianId}`)
    const earningRows = (ledger2.body?.data ?? []).filter(r => r.entryType === 'Earning' && r.sourceId === target.id)
    log('  ↳ tekrar onay ikinci defter satırı üretmiyor', earningRows.length === 1, `${earningRows.length} satır`)

    // Ödeme (borç) girişi
    const pay = await api('/api/earnings/ledger/payment', {
      method: 'POST',
      body: JSON.stringify({ technicianId: target.technicianId, amount: 40, currency: 'USD', description: 'Otomatik test ödemesi' }),
    })
    log('  ↳ personele ödeme girilebiliyor', pay.status === 200, `${pay.status}`)

    const ledger3 = await api(`/api/earnings/ledger?technicianId=${target.technicianId}&currency=USD`)
    const rows3 = ledger3.body?.data ?? []
    const usdBalance = (ledger3.body?.balances ?? []).find(b => b.currency === 'USD')?.balance
    // Mutlak değer yerine defterin kendi içinde tutarlılığı ölçülüyor: koşu tekrarlandığında
    // ödemeler birikiyor, sabit bir rakam beklemek testi kırılgan yapardı.
    const expected = rows3.reduce((acc, r) => acc + Number(r.credit || 0) - Number(r.debit || 0), 0)
    log('  ↳ bakiye borç/alacaktan hesaplanıyor', Math.abs(Number(usdBalance) - expected) < 0.001,
      `USD bakiye=${usdBalance}, hesaplanan=${expected}`)
  } else {
    log('  ↳ Hak ediş kaydı yok (tamamlanmış iş bulunamadı)', false, 'atlandı')
  }

  // --- Test 13 / #32: Bayi performans raporu ---
  const perf = await api('/api/servicerecords/dealer-performance')
  log('#32 — Bayi servis performans raporu', perf.status === 200,
    `${perf.status}, ${perf.body?.data?.length ?? 0} bayi, toplam=${perf.body?.totals?.total ?? 0}`)

  // --- Bildirimler (#41): teknisyen olmayan oturumda 401/500 vermemeli ---
  const notif = await api('/api/notifications')
  log('#41 — Bildirim ucu teknisyen olmayan oturumda hata vermiyor', notif.status === 200, `${notif.status}`)

  // --- Zaman çizelgesi (#45) ---
  if (bigId) {
    const tl = await api(`/api/servicerecords/${bigId}/timeline`)
    const events = Array.isArray(tl.body) ? tl.body : []
    log('#45 — Servis geçmişi zaman çizelgesi', tl.status === 200 && events.length > 0, `${events.length} olay`)
    const fabricated = events.some(e => String(e.authorName || '').includes('Tarık Öztürk'))
    log('  ↳ uydurma aktör adı yok', !fabricated)
  }

  finish()
}

function finish() {
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  console.log(`\n=== SONUÇ: ${passed}/${results.length} geçti ===`)
  if (failed.length) {
    console.log('\nKALANLAR:')
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
  }
  if (createdRecordIds.length) {
    console.log(`\nOluşturulan test kayıtları: ${createdRecordIds.join(', ')}`)
  }
}

main().catch(e => { console.error('TEST KOŞUSU PATLADI:', e); process.exit(1) })
