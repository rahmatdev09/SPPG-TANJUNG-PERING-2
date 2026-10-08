# MBG System

Aplikasi web progresif (PWA) untuk mengelola operasional SPPG Program Makan Bergizi Gratis. Aplikasi menggunakan HTML, CSS, JavaScript module, Firebase Authentication, dan Cloud Firestore.

## Menjalankan aplikasi

Proyek ini tidak menggunakan proses build atau package manager. Jalankan berkas melalui server lokal, jangan membuka HTML dengan skema `file://`.

1. Buka folder proyek di Visual Studio Code.
2. Jalankan `index.html` dengan ekstensi **Live Server**, atau gunakan server HTTP lokal lain.
3. Pastikan domain lokal yang digunakan, misalnya `localhost`, sudah terdaftar di **Firebase Authentication > Settings > Authorized domains**.
4. Login menggunakan akun Google yang sudah terdaftar di koleksi `app_users`.

> Aplikasi memuat Firebase SDK dan Tailwind CSS dari CDN, sehingga koneksi internet diperlukan.

## Halaman utama

| Halaman                         | Kegunaan                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `index.html`                    | Dashboard ringkasan                                                                 |
| `barang.html`                   | Kelola bahan baku, penerimaan, persetujuan, dan RAB                                 |
| `barang.html?jenis=operasional` | Kelola barang operasional secara terpisah dari bahan baku                           |
| `master-barang.html`            | Kelola katalog pilihan barang bahan baku dan operasional                            |
| `stok.html`                     | Kelola stok, batas minimum, peringatan restok, riwayat transaksi, serta stok opname |
| `supplier.html`                 | Data supplier dan rekening                                                          |
| `pm.html`                       | Data penerima manfaat, porsi, pagu, insentif mitra, lokasi, dan rute                |
| `menu.html`                     | Data menu dan informasi AKG                                                         |
| `dokumen.html`                  | Dokumen yang tersimpan di Google Drive                                              |
| `surat.html`                    | Buat, simpan, buka kembali, dan hapus surat permintaan pembayaran                   |
| `user.html`                     | Pengaturan akun dan role pengguna                                                   |
| `setting.html`                  | Identitas dapur/yayasan, logo, lokasi, dan nama penandatangan                       |
| `tentang.html`                  | Informasi aplikasi dan layanan                                                      |
| `admin-penerimaan.html`         | Antarmuka PWA admin logistik untuk dashboard, penerimaan barang, stok, dan profil   |
| `landing-page/index.html`       | Landing page SPPG Smart, login Google, portal paket pengguna, dan panel admin |

Landing page, portal paket, dan panel admin memakai akun serta Firebase project yang sama dengan aplikasi utama (`sppg-abc46`). Akun Google harus sudah terdaftar di koleksi `app_users`. Super Admin mengelola paket secara manual; pembayaran belum terhubung. Petunjuk portal tersedia di [`landing-page/README.md`](./landing-page/README.md).

## Firebase

Konfigurasi Firebase web berada di bagian awal `app.js`. Project yang saat ini digunakan adalah `sppg-abc46`. Pastikan Authentication dan Cloud Firestore aktif pada project tersebut.

### Menyiapkan akun Super Admin pertama

Sebelum login pertama, buat dokumen melalui Firebase Console > Firestore Database dengan ketentuan:

- Koleksi: `app_users`
- ID dokumen: email Google dalam huruf kecil, misalnya `admin@example.com`
- Field `email` (string): email Google tersebut
- Field `role` (string): `super_admin`
- Field `active` (boolean): `true`
- Field `createdAt` (string): tanggal/waktu pembuatan

Setelah Super Admin pertama bisa login, akun berikutnya dapat dikelola dari menu **Pengguna**. Email pengguna dinormalisasi menjadi huruf kecil.

### Firestore Rules

Publikasikan isi berkas [`firestore.rules`](./firestore.rules) ke Firebase Console > Firestore Database > **Rules** setiap kali aturan berubah. Koleksi aplikasi yang diatur di dalamnya meliputi:

- `app_users`: akun dan role; pengelolaannya khusus Super Admin.
- Data operasional dibatasi untuk akun Premium aktif; Super Admin tetap memiliki akses untuk pengelolaan pengguna dan paket.
- `mbg_items`, `operational_items`, `master_items`, `inventory_items`, `suppliers`, `menus`, `barang_arrival_photos`, dan `payment_letters`: hanya dapat diakses akun aktif yang memiliki role `super_admin` atau `admin_logistik`.
- `app_metadata`: penanda migrasi awal katalog stok.
- `app_settings`: identitas dapur/yayasan, logo, lokasi, dan penandatangan yang dibagikan ke seluruh perangkat.
- `pms`: dapat dibaca akun aktif dan hanya dapat diubah Super Admin.
- Dokumen lain ditolak secara default.

> Jika tabel surat menampilkan akses ditolak, pastikan aturan untuk `payment_letters` sudah ikut dipublikasikan ke Firebase, lalu muat ulang halaman.

Panduan pembuatan akun awal juga tersedia di [`AKSES_PENGGUNA.md`](./AKSES_PENGGUNA.md).

### Google Drive

Halaman Dokumen meminta izin Google Drive melalui login Google. Aktifkan **Google Drive API** di Google Cloud project Firebase yang digunakan dan pastikan konfigurasi OAuth mengizinkan origin aplikasi. Login web Firebase tetap terpisah dari sesi izin Drive.

### Data pengaturan dan surat

- Pengaturan dapur, yayasan, logo, lokasi, dan nama penandatangan disimpan bersama di `app_settings/organization`. Data lama di `localStorage` dimigrasikan otomatis saat dokumen bersama belum tersedia; cache lokal tetap dipakai untuk mempercepat tampilan.
- Surat permintaan pembayaran disimpan di koleksi Firestore `payment_letters`. Surat tersimpan mencakup rincian barang, supplier, penandatangan, salinan kop, dan lampiran yang dikompres. Total ukuran lampiran dibatasi agar dokumen tidak melewati batas Firestore.
- Master Barang disimpan di `master_items`. Setiap master memiliki `kategori` (`bahan_baku` atau `operasional`), `nama`, dan `satuan`. Tambahkan barang melalui halaman Master Barang terlebih dahulu; form Kelola Barang kemudian hanya menampilkan master sesuai kategorinya dan mengisi nama serta satuan secara otomatis. Tabel Master Barang mendukung pencarian, filter kategori, dan pagination 10, 25, atau 50 baris.
- Barang harian memakai koleksi terpisah: `mbg_items` untuk bahan baku dan `operational_items` untuk barang operasional. Barang baru menyimpan referensi `masterItemId` dan kategori; barang lama yang belum tertaut tetap dapat diedit dan dipautkan ke master yang cocok. Mode operasional dibuka melalui `barang.html?jenis=operasional`.
- Kelola Barang dan Kelola Operasional memakai pagination 10, 25, atau 50 baris; pencarian dan filter mengembalikan daftar ke halaman pertama.
- Insentif Mitra dihitung dari jumlah penerima PM aktif dikali Rp2.000. Nilai per mitra dan totalnya tampil di halaman Penerima Manfaat; total agregat juga tampil pada Dashboard.
- Admin Penerimaan menyediakan pilihan Bahan Baku atau Operasional. Daftar pending dan transaksi penerimaan mengikuti koleksi yang dipilih. Surat Permintaan Pembayaran juga memiliki pilihan kategori dan membatasi pilihan barang, tambah-semua, serta foto penerimaan ke kategori tersebut.
- `inventory_items` menyimpan saldo serta riwayat persediaan. Saat pembaruan pertama, saldo lama yang memiliki stok atau riwayat disalin satu kali ke katalog persediaan dan barang dengan nama serta satuan yang sama digabung. Penerimaan PWA berikutnya mencatat transaksi ke persediaan.
- Setiap barang stok dapat memiliki `minimumStock`. Peringatan muncul di Stok Barang dan dashboard PWA saat saldo sama dengan atau di bawah nilai tersebut; nilai `0` menonaktifkan peringatan.

## PWA dan cache

Service worker berada di `sw.js`; daftar halaman dan aset offline diatur pada `APP_SHELL`. Versi cache perlu dinaikkan saat mengubah aset agar browser dan PWA mengambil berkas terbaru. Setelah pembaruan, muat ulang aplikasi jika tampilan lama masih tersimpan.
