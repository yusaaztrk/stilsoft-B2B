/**
 * `qrcode` paketi tip tanimi TASIMIYOR ve projede `@types/qrcode` kurulu degil.
 *
 * Bagimliliklar yerel tarball'lardan kuruluyor (bkz. package.json `vendor/packages`), bu yuzden
 * yeni bir @types paketi eklemek yerine kullanilan yuzey burada bildiriliyor. Paket buyudukce
 * bu dosyaya eklemek yeterli.
 */
declare module 'qrcode' {
  export type QRCodeErrorCorrectionLevel = 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H'

  export interface QRCodeToDataURLOptions {
    margin?: number
    width?: number
    scale?: number
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel
    type?: 'image/png' | 'image/jpeg' | 'image/webp'
    quality?: number
    color?: {
      dark?: string
      light?: string
    }
  }

  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>
  export function toString(text: string, options?: QRCodeToDataURLOptions): Promise<string>

  const QRCode: {
    toDataURL: typeof toDataURL
    toString: typeof toString
  }

  export default QRCode
}
