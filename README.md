# mylayovers-hist

Layover uygulamasının "Geçmiş uçuşlar" bölümü için veri üretir.
Her gün adsb.lol'un açık arşivinden THY uçuşlarının iniş/kalkış pistini ve park pozisyonunu çıkarır,
sonuçları bu deponun `data` dalına yazar. Uygulama veriyi oradan okur.

- Çalıştırma: Actions → "Geçmiş uçuşlar" → Run workflow (ilk seferde `max` = 32).
- Kendiliğinden: her gün 13:17Z ve 23:17Z.
- Veri lisansı: ODbL (bkz. DATA-LICENSE.md).
