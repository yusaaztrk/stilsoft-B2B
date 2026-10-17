/**
 * JSON-LD verisini `<script>` etiketi içine güvenle basar.
 *
 * `JSON.stringify` `<` karakterini kaçırmıyor. İçerik (ürün adı, SSS metni, bayinin panelden
 * yazdığı içerik) `</script><script>...` gibi bir dizi içerirse script etiketinden erken
 * çıkıp arkasından gelen HTML'i çalıştırılabilir hâle getirir. `<` olarak kaçırmak JSON
 * anlamını değiştirmez (tarayıcı onu yine `<` olarak okur) ama artık etiketi kapatamaz.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
