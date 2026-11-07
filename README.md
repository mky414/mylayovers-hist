# Layover — geçmiş uçuş verisi

Bu daldaki dosyalar [adsb.lol](https://adsb.lol) günlük arşivinden ([globe_history](https://github.com/adsblol/globe_history_2026)) türetilmiştir.
Kaynak veri ve bu türetilmiş veri [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/) kapsamındadır.
Pist eşikleri: [OurAirports](https://ourairports.com/data/) (kamu malı).

Biçim: `a/<ICAO>/<ÇAĞRI>.json` inişler, `d/<ICAO>/<ÇAĞRI>.json` kalkışlar —
her satır `[unix zamanı, pist, park enlem, park boylam, tescil, tip]`. `_sum.json` meydan özeti.
