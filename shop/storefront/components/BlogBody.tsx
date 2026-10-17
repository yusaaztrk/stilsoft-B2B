import type { BlogBlock } from '@/lib/blog'

/**
 * Yazı gövdesini işaretlemeye çeviren tek yer.
 *
 * <b>Neden `dangerouslySetInnerHTML` yok:</b> içerik yapılandırılmış veri olarak geliyor ve
 * her blok kendi etiketiyle çiziliyor. Yazı metni hiçbir noktada HTML olarak yorumlanmıyor —
 * yani ileride yazılar panelden yönetilir hâle gelse bile bu bileşen betik enjeksiyonuna
 * kapı açmaz. Bu, `sayfa/[slug]` içeriklerinde de bilinçli olarak korunan kural.
 *
 * <b>Başlık düzeyleri:</b> sayfada H1 yalnızca yazı başlığıdır; gövde H2 ile başlar.
 * Arama motoru için başlık hiyerarşisinin tutarlı olması, anahtar kelime yoğunluğundan
 * daha belirleyici.
 */
export default function BlogBody({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <div className="blog-body">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'h2':
            return <h2 key={i}>{block.text}</h2>
          case 'h3':
            return <h3 key={i}>{block.text}</h3>
          case 'ul':
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ol>
            )
          case 'quote':
            return <blockquote key={i}>{block.text}</blockquote>
          case 'note':
            return (
              <aside key={i} className="blog-note">
                <strong>{block.title}</strong>
                <p>{block.text}</p>
              </aside>
            )
          case 'table':
            /*
              Tablo KENDİ kabında yatay kayar. Sayfanın gövdesi asla yatay kaymamalı:
              geniş bir tablo mobilde tüm düzeni bozuyor ve kullanıcı metni okumak için
              sağa sola kaydırmak zorunda kalıyordu.
            */
            return (
              <div key={i} className="blog-table-wrap">
                <table className="blog-table">
                  <thead>
                    <tr>
                      {block.head.map((h, j) => (
                        <th key={j}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'p':
          default:
            return <p key={i}>{block.text}</p>
        }
      })}
    </div>
  )
}
