# Menerbitkan JELAS ke Google Play

Semua bahan sudah disiapkan di folder ini:

- `ss2-belajar.png`, `ss3-soal.png`, `ss4-liga.png`, `ss5-profil.png` — tangkapan layar HP (1082×1922)
- `feature-1024x500.png` — gambar unggulan (feature graphic)
- Ikon 512×512: `../icons/icon-512.png`
- Kebijakan privasi: https://jelajahkelas.github.io/privacy.html
- Penghapusan akun: dijelaskan di bagian "Menghapus akun" pada kebijakan privasi

## Langkah (dilakukan pemilik akun)

1. Daftar akun **Google Play Console** (biaya sekali sekitar US$25).
2. Buka **pwabuilder.com**, masukkan `https://jelajahkelas.github.io`, pilih **Package for stores → Android**.
   - Package ID: `io.github.jelajahkelas.twa`
   - Unduh berkas zip. Di dalamnya ada `app-release-bundle.aab`, kunci penandatanganan (`signing.keystore` + sandinya) dan `assetlinks.json`.
   - **Simpan kunci penandatanganan baik-baik.** Tanpa kunci ini aplikasi tidak bisa diperbarui.
3. Kirim isi `assetlinks.json` ke Claude (isinya bukan rahasia) supaya dipasang di `/.well-known/assetlinks.json`. Ini membuat aplikasi tampil layar penuh tanpa bilah alamat.
4. Di Play Console: buat aplikasi baru, unggah `.aab`, isi deskripsi dan gambar dari folder ini.
5. Bagian **Konten aplikasi**: target usia mencakup anak-anak → ikuti program **Designed for Families**. Jawab: tanpa iklan, data yang dikumpulkan sesuai kebijakan privasi.

## Teks toko (bisa disalin)

**Nama:** JELAS · Jelajah Kelas

**Deskripsi singkat (≤80 karakter):** Belajar seru sambil main, dari TK sampai SMA/SMK. Gratis untuk murid.

**Deskripsi lengkap:**
JELAS (Jelajah Kelas) membuat belajar terasa seperti bermain. Bersama Uli si burung hantu, anak belajar Matematika, Bahasa, IPA, IPS, Agama, dan lainnya lewat pelajaran singkat, game, dan tantangan bersama teman.

• Pelajaran 5 menit dari TK sampai SMA/SMK
• Game edukatif: Petualangan Blok, balapan, menembak jawaban, dan banyak lagi
• Runtunan harian, liga mingguan, misi, dan lencana
• Mode TK: soal dibacakan, menebalkan huruf, mewarnai, mencocokkan
• Guru bisa membuat kelas, memberi tugas dan modul, absensi, dan rapor otomatis
• Laporan untuk orang tua
• Tanpa iklan
