import React from 'react'

interface ReportPageProps {
  record: any
  pageIndex: number // 1 or 2
  totalPages: number
}

function cleanProblemDesc(desc?: string): string {
  if (!desc) return ''
  return desc
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return (
        !trimmed.startsWith('Ek Açıklama:') &&
        !trimmed.startsWith('Garanti Başlangıcı:') &&
        !trimmed.startsWith('Müşteri Tipi:') &&
        !trimmed.startsWith('Fatura Numarası:') &&
        !trimmed.startsWith('Fatura Tipi:') &&
        !trimmed.startsWith('Servis Açıklaması:')
      )
    })
    .join('\n')
    .trim()
}

/**
 * Basılan belge türü — KAYITTAN belirlenir.
 *
 * Elimizdeki dört örnek belge iki ayrı forma karşılık geliyor:
 *
 *   Küçük ürün                        → "SERVİS ARIZA FORMU"  (logosuz, ayrı alanlar)
 *   Montaj / beyaz eşya               → "HİZMET FİŞİ"         (logolu, sağ üstte tür etiketi)
 *       montaj + fatura no var        → etiket FATURA (+ fatura no basılır)
 *       montaj + fatura no yok        → etiket BAYI
 *       arıza (beyaz eşya)            → etiket ARIZA
 *
 * Bu ekran daha önce HER kayıt için "SERVİS ARIZA FORMU" basıyordu; montaj ve beyaz eşya
 * fişleri hiç üretilmiyordu.
 */
function resolveDocKind(record: any) {
  const category = String(record?.category ?? record?.productCategory ?? '').toLowerCase()
  const type = String(record?.type ?? '').toLowerCase()

  const invoiceNo =
    String(record?.invoiceReference ?? '').trim() ||
    (String(record?.problemDescription ?? '').match(/Fatura\s*(?:No|Numarası)\s*:\s*(\S+)/i)?.[1] ?? '').trim()

  const isSmall = category === 'small'
  const isInstallation = type === 'installation'

  return {
    isSmall,
    invoiceNo,
    label: isInstallation ? (invoiceNo ? 'FATURA' : 'BAYI') : 'ARIZA',
  }
}

/** Belgelerin üst sol köşesindeki sabit firma bloğu. */
function CompanyBlock() {
  return (
    <div className="text-[11px] leading-tight text-black font-medium">
      <div className="font-bold text-[12px] mb-0.5">DEMO TİCARET LİMİTED</div>
      <div>Örnek Mah. Demo Cad. No:1</div>
      <div>99010 Lefkoşa - KKTC</div>
      <div>www.example.com</div>
      <div>info@example.com</div>
      <div>Tüketi Danışma Hattı : 0 850 000 00 00</div>
    </div>
  )
}

const PAGE_STYLE: React.CSSProperties = {
  width: '210mm',
  minHeight: '297mm',
  boxSizing: 'border-box',
  margin: '0 auto',
}

/**
 * HİZMET FİŞİ — montaj ve beyaz eşya.
 *
 * Örnek belgelerdeki düzen: solda firma bilgisi ve fiş no, sağda tarih + logo + tür etiketi
 * (FATURA ise altında fatura numarası). Ardından tek sütunlu HİZMET FİŞİ tablosu, ÜRÜN
 * BİLGİLERİ tablosu (ürün adı + miktar), serbest AÇIKLAMA alanı ve iki imza kutusu.
 */
function HizmetFisi({ record, label, invoiceNo }: { record: any; label: string; invoiceNo: string }) {
  const rawDate = record?.plannedDate || record?.createdAt || record?.date || record?.createDate
  const docDate = rawDate
    ? new Date(rawDate).toLocaleDateString('tr-TR')
    : new Date().toLocaleDateString('tr-TR')

  const stockCode = record?.stockCode || record?.productCode || record?.sku || ''
  const rawProdName = record?.productName || ''
  const productNameWithCode =
    stockCode && !rawProdName.includes(stockCode) ? `${stockCode} ${rawProdName}` : rawProdName

  const items: any[] = Array.isArray(record?.items) && record.items.length > 0 ? record.items : []
  const fallbackQty = Number(record?.totalQuantity) || 1

  const description =
    cleanProblemDesc(record?.problemDescription) ||
    record?.description ||
    record?.serviceNote ||
    ''

  const cell = 'border border-black px-2 py-1.5'
  const labelCell = `${cell} font-bold w-[22%] text-left`

  return (
    <div
      className="report-page-container w-full bg-white text-black leading-tight border border-slate-300 p-8 sm:p-10 shadow-2xl relative flex flex-col justify-between select-text"
      style={{ ...PAGE_STYLE, fontFamily: "'Times New Roman', Times, serif" }}
    >
      <div>
        {/* Üst başlık: firma / tarih + logo + tür */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <CompanyBlock />
            <div className="text-[11px] mt-0.5">{record?.serviceNumber || ''}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium">{docDate}</div>
            <div
              className="font-black text-[38px] leading-none text-[#E30613] mt-1"
              style={{ fontFamily: "'Helvetica Neue', Arial, Helvetica, sans-serif" }}
            >
              stilsoft
            </div>
          </div>
        </div>

        {/* Tür etiketi ve fatura numarası — sağa dayalı */}
        <div className="text-right mb-6">
          <div className="text-[15px] font-bold tracking-wide uppercase">{label}</div>
          {invoiceNo ? <div className="text-[11px] font-bold mt-1">{invoiceNo}</div> : null}
        </div>

        {/* HİZMET FİŞİ */}
        <table className="w-full border-collapse border border-black text-[11px] mb-6">
          <thead>
            <tr>
              <th colSpan={2} className={`${cell} text-center font-bold text-[12px]`}>
                HİZMET FİŞİ
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={labelCell}>Adı - Soyadı</td>
              <td className={cell}>{record?.customerName || ''}</td>
            </tr>
            <tr>
              <td className={labelCell}>Adres</td>
              <td className={`${cell} whitespace-pre-wrap break-words`}>
                {record?.customerAddress || ''}
              </td>
            </tr>
            <tr>
              <td className={labelCell}>Bölge</td>
              <td className={cell}>{record?.regionName || record?.district || ''}</td>
            </tr>
            <tr>
              <td className={labelCell}>Telefon</td>
              <td className={cell}>{record?.customerPhone || ''}</td>
            </tr>
            <tr>
              <td className={labelCell}>Bayi Adı</td>
              <td className={cell}>{record?.dealerName || ''}</td>
            </tr>
            <tr>
              <td className={labelCell}>Bayi Telefon</td>
              <td className={cell}>{record?.dealerPhone || ''}</td>
            </tr>
          </tbody>
        </table>

        {/* ÜRÜN BİLGİLERİ */}
        <table className="w-full border-collapse border border-black text-[11px]">
          <thead>
            <tr>
              <th colSpan={2} className={`${cell} text-center font-bold text-[12px]`}>
                ÜRÜN BİLGİLERİ
              </th>
            </tr>
            <tr>
              <th className={`${cell} text-center font-bold`}>ÜRÜN ADI</th>
              <th className={`${cell} text-center font-bold w-[15%]`}>MİKTAR</th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? (
              items.map((it: any, i: number) => (
                <tr key={i}>
                  <td className={cell}>{it?.productName || it?.name || ''}</td>
                  <td className={`${cell} text-center`}>{Number(it?.quantity) || 1}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className={cell}>{productNameWithCode}</td>
                <td className={`${cell} text-center`}>{fallbackQty}</td>
              </tr>
            )}
            <tr>
              <th colSpan={2} className={`${cell} text-center font-bold`}>
                AÇIKLAMA
              </th>
            </tr>
            <tr>
              <td
                colSpan={2}
                className={`${cell} align-top whitespace-pre-wrap break-words`}
                style={{ height: '38mm' }}
              >
                {description}
              </td>
            </tr>
            <tr>
              <td className={`${cell} text-center font-bold w-1/2`}>SERVİS SORUMLUSU</td>
              <td className={`${cell} text-center font-bold w-1/2`}>MÜŞTERİ</td>
            </tr>
            <tr>
              <td className={`${cell} text-center font-bold`}>
                {record?.assignedTechnicianName || ''}
              </td>
              <td className={`${cell} text-center font-bold`}>{record?.customerName || ''}</td>
            </tr>
            <tr>
              <td className={`${cell} text-center font-bold`}>İMZA</td>
              <td className={`${cell} text-center font-bold`}>İMZA</td>
            </tr>
            <tr>
              <td className={cell} style={{ height: '18mm' }}></td>
              <td className={cell}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * SERVİS ARIZA FORMU — küçük ürün.
 *
 * Alanlar örnek belgeye göre: Tüketici Bilgileri + Ürün Bilgileri yan yana, altında Arıza
 * Bilgileri ve en altta sorumluluk notu.
 */
function ServisArizaFormu({ record, pageIndex }: { record: any; pageIndex: number }) {
  const stockCode = record?.stockCode || record?.productCode || record?.sku || ''
  const rawProdName = record?.productName || ''
  const productNameWithCode =
    stockCode && !rawProdName.includes(stockCode) ? `${stockCode} ${rawProdName}` : rawProdName

  const rawDate = record?.plannedDate || record?.createdAt || record?.date || record?.createDate
  const acceptDate = rawDate
    ? new Date(rawDate).toLocaleDateString('tr-TR')
    : new Date().toLocaleDateString('tr-TR')

  const customerName = record?.customerName || record?.customer || ''
  const dealerName = record?.dealerName || record?.dealer || record?.customerCariName || ''
  const cleanComplaint = cleanProblemDesc(record?.problemDescription)

  // Belgede tutar "0,00" biçiminde, virgüllü.
  const fee = Number(record?.totalCost ?? record?.processingFee ?? 0)
    .toFixed(2)
    .replace('.', ',')

  const copyLabel = pageIndex === 1 ? '1. NÜSHA - SERVİS NÜSHASI' : '2. NÜSHA - MÜŞTERİ NÜSHASI'

  const cell = 'border-2 border-black px-2 py-1.5'
  const labelCell = `${cell} font-bold text-left bg-gray-50/60`

  return (
    <div
      className="report-page-container w-full bg-white text-black leading-tight border border-slate-300 p-8 sm:p-10 shadow-2xl relative flex flex-col justify-between select-text"
      style={{ ...PAGE_STYLE, fontFamily: "'Times New Roman', Times, serif" }}
    >
      <div>
        <div className="flex justify-between items-start mb-4 border-b border-black pb-3">
          <CompanyBlock />
          <div className="text-center font-bold self-center text-black uppercase">
            <h2 className="text-base tracking-wide font-black">SERVİS ARIZA FORMU</h2>
            <span className="text-[11px] font-semibold text-gray-700 block font-mono mt-0.5">
              ({copyLabel})
            </span>
          </div>
          <div className="text-right text-[11px] font-bold text-gray-800">
            <div>Tarih: {acceptDate}</div>
            <div className="font-mono text-[10px] text-gray-500 mt-1">Sayfa: {pageIndex} / 2</div>
          </div>
        </div>

        <div className="flex justify-between font-bold text-[12px] text-black mb-1">
          <div className="w-[52%]">Tüketici Bilgileri</div>
          <div className="w-[45%]">Ürün Bilgileri</div>
        </div>

        <div className="flex justify-between gap-4 mb-4">
          <div className="w-[52%]">
            <table className="w-full border-collapse border-2 border-black text-[11px]">
              <tbody>
                <tr>
                  <td className={`${labelCell} w-[38%]`}>Müşteri Adı</td>
                  <td className={`${cell} font-bold whitespace-pre-wrap break-words`}>
                    {customerName || '-'}
                  </td>
                </tr>
                <tr>
                  <td className={labelCell}>Bayi Müşteri</td>
                  <td className={`${cell} font-semibold whitespace-pre-wrap break-words`}>
                    {dealerName || '-'}
                  </td>
                </tr>
                <tr>
                  <td className={labelCell}>Müşteri Telefon</td>
                  <td className={`${cell} font-semibold`}>
                    {record?.customerPhone || record?.dealerPhone || '-'}
                  </td>
                </tr>
                <tr>
                  <td className={labelCell}>Müşteri Adres</td>
                  <td className={`${cell} whitespace-pre-wrap break-words leading-snug`}>
                    {record?.customerAddress || record?.dealerAddress || '-'}
                  </td>
                </tr>
                <tr>
                  <td className={labelCell}>Müşteri İlçe</td>
                  <td className={`${cell} whitespace-pre-wrap break-words`}>
                    {record?.customerDistrict || record?.district || record?.regionName || '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="w-[45%]">
            <table className="w-full border-collapse border-2 border-black text-[11px]">
              <tbody>
                <tr>
                  <td className={`${labelCell} w-[38%]`}>Ürün Adı</td>
                  <td className={`${cell} font-bold whitespace-pre-wrap break-words`}>
                    {productNameWithCode || '-'}
                  </td>
                </tr>
                <tr>
                  <td className={labelCell}>Servis Fiş No</td>
                  <td className={`${cell} font-mono font-bold text-black`}>
                    {record?.serviceNumber || record?.id || '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="font-bold text-[12px] text-black mb-1">Arıza Bilgileri</div>
        <table className="w-full border-collapse border-2 border-black text-[11px] mb-4">
          <tbody>
            <tr>
              <td className={`${labelCell} w-[38%]`}>Kabul Tarihi</td>
              <td className={`${cell} font-medium`}>{acceptDate}</td>
            </tr>
            <tr>
              <td className={labelCell}>Müşteri Şikayeti</td>
              <td className={`${cell} whitespace-pre-wrap break-words leading-snug font-medium`}>
                {cleanComplaint || '-'}
              </td>
            </tr>
            <tr>
              <td className={labelCell}>Açıklama</td>
              <td className={`${cell} whitespace-pre-wrap break-words leading-snug font-medium`}>
                {record?.description ||
                  record?.receivingNote ||
                  record?.serviceNote ||
                  record?.additionalNotes ||
                  '-'}
              </td>
            </tr>
            <tr>
              <td className={labelCell}>İşlem Ücreti</td>
              <td className={`${cell} font-medium`}>{fee}</td>
            </tr>
            <tr>
              <td className={labelCell}>Müşteri İmzası</td>
              <td className={`${cell} h-12`}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="border-t border-black pt-2 mt-4 text-[13px] font-bold text-center text-black uppercase tracking-wide">
        3 ay içerisinde alınmayan üründen meshul değiliz
      </div>
    </div>
  )
}

export default function ReportPage({ record, pageIndex }: ReportPageProps) {
  const { isSmall, label, invoiceNo } = resolveDocKind(record)

  if (isSmall) {
    return <ServisArizaFormu record={record} pageIndex={pageIndex} />
  }

  return <HizmetFisi record={record} label={label} invoiceNo={invoiceNo} />
}
