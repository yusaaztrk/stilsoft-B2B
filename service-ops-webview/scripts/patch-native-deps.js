/**
 * node_modules içindeki eski Gradle dosyalarını onarır.
 *
 * `postinstall` olarak koşuyor: npm install kütüphaneyi her indirdiğinde yama yeniden
 * uygulanır. Elle düzeltmek işe yaramıyordu — bir sonraki `npm install` geri alıyordu.
 *
 * Yama zaten uygulanmışsa hiçbir şey yapmaz; kütüphane yoksa sessizce geçer. Bu betik
 * yüzünden kurulum ASLA başarısız olmamalı: bozuk bir yama bütün projeyi kurulamaz hâle
 * getirirdi.
 */

const fs = require('fs');
const path = require('path');

/**
 * react-native-tts (son sürüm 4.1.1, 2021) kendi `build.gradle`'ında `jcenter()` çağırıyor.
 *
 * jcenter 2021'de kapandı ve Gradle 9 metodu tamamen KALDIRDI: derleme daha yapılandırma
 * aşamasında "Could not find method jcenter()" ile duruyor, tek satır kod derlenmiyor.
 *
 * Sorunlu blok kütüphanenin KENDİ `buildscript`'i ve gereksiz: uygulamanın içinde bir modül
 * olarak derlendiği için Android Gradle eklentisini kök projeden alıyor. Blok komple siliniyor
 * (içinde ayrıca `com.android.tools.build:gradle:1.3.1` var — 2015'ten kalma bir sürüm).
 */
function patchReactNativeTts() {
  const file = path.join(__dirname, '..', 'node_modules', 'react-native-tts', 'android', 'build.gradle');
  if (!fs.existsSync(file)) return;

  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('jcenter()')) return;

  const patched = source.replace(
    /buildscript\s*\{[\s\S]*?\n\}\n/,
    '// buildscript bloğu kaldırıldı (jcenter kapandı) — scripts/patch-native-deps.js\n',
  );

  if (patched === source) {
    console.warn('[patch-native-deps] react-native-tts: beklenen buildscript bloğu bulunamadı, atlandı.');
    return;
  }

  fs.writeFileSync(file, patched);
  console.log('[patch-native-deps] react-native-tts/android/build.gradle yamandı (jcenter kaldırıldı).');
}

try {
  patchReactNativeTts();
} catch (error) {
  console.warn('[patch-native-deps] Yama uygulanamadı:', error.message);
}
