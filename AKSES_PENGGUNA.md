# Pengaturan akses pengguna

1. Buka Firebase Console untuk project `sppg-abc46`, lalu buka **Firestore Database**.
2. Buat dokumen pertama di koleksi `app_users`. Gunakan ID dokumen berupa email Google Super Admin dalam huruf kecil, misalnya `admin@gmail.com`.
3. Isi field awal:

   - `email` (string): email Google Super Admin
   - `role` (string): `super_admin`
   - `active` (boolean): `true`
   - `createdAt` (string): tanggal/waktu pembuatan

4. Publikasikan isi `firestore.rules` ke tab **Rules** Firestore. Rules ini menolak akses database bagi akun yang tidak tercatat aktif.
5. Login menggunakan email Super Admin tersebut. Setelah itu akun Admin Logistik dan Super Admin berikutnya bisa dikelola melalui menu **Pengguna**.

Email akun yang ditambahkan disimpan dalam huruf kecil dan harus sama dengan akun Google yang dipakai untuk login. Admin Logistik dapat mengelola barang, stok, menu, dan supplier. Perubahan penerima manfaat, dokumen, pengaturan, dan akun pengguna hanya untuk Super Admin.
