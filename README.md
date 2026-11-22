# Discord Bot

Discord bot untuk formulir Guild Appeal, voting, pengelolaan status, dan warning member.

## Runtime

- Node.js 24.x
- Entry point: `src/index.js`
- Instalasi dependency: `npm ci`
- Start: `npm start`

Dependency aplikasi tercatat di `package.json` dan dikunci di `package-lock.json`. SQLite menggunakan modul bawaan Node.js (`node:sqlite`); database dibuat di `data/appeals.db`.

## Environment variables

Salin `.env.example` sebagai acuan. Isi nilainya melalui environment variables/secrets di Lunafy, bukan di GitHub:

| Variable | Kegunaan |
| --- | --- |
| `DISCORD_TOKEN` | Token bot; wajib untuk menjalankan bot |
| `CLIENT_ID` | ID Discord Application; diperlukan untuk deploy slash commands |
| `GUILD_ID` | ID server Discord; diperlukan untuk deploy slash commands |
| `OWNER_ROLE_ID` | ID role Owner |
| `STAFF_ROLE_ID` | ID role Staff |
| `JOIN_APPEAL_CHANNEL_ID` | Channel panel pengajuan |
| `GUILD_APPEAL_CHANNEL_ID` | Channel untuk hasil formulir/voting |
| `APPEAL_LOG_CHANNEL_ID` | Channel audit log |

`APPEAL_CHANNEL_ID` dan `STAFF_CHANNEL_ID` masih didukung sebagai nama lama, tetapi gunakan nama variable baru di atas untuk deployment baru.

Jangan pernah mengisi secret asli ke `.env.example`, README, source code, atau GitHub Secrets yang tidak diperlukan. `.env` dan file `.env.*` diabaikan Git; `.env.example` tetap boleh di-commit karena nilainya kosong.

## Deploy ke Lunafy dari GitHub

1. Pastikan commit yang akan dipush tidak berisi `.env`:

   ```bash
   git check-ignore -v .env
   git status --short
   ```

   Pastikan `.env` tidak tercantum di hasil `git status`.

2. Push branch project ke GitHub, lalu buat/import aplikasi Node.js di Lunafy dari repository dan branch tersebut.
3. Pilih runtime **Node.js 24.x**.
4. Atur install command `npm ci` dan start command `npm start` (atau biarkan Lunafy menggunakan script `start` dari `package.json`).
5. Tambahkan environment variables pada bagian Variables/Secrets di dashboard Lunafy. Masukkan `DISCORD_TOKEN` secara langsung di sana; jangan upload `.env`.
6. Pastikan bot memiliki izin melihat dan mengirim pesan serta menyertakan embed di channel yang dikonfigurasi. Jalankan satu instance bot saja.
7. Deploy slash commands sekali setelah `DISCORD_TOKEN`, `CLIENT_ID`, dan `GUILD_ID` tersedia, dengan menjalankan `npm run deploy` melalui console/command runner Lunafy. Setelah selesai, biarkan proses utama berjalan menggunakan `npm start`.
8. Database SQLite berada di `data/appeals.db`. Jika Lunafy memakai filesystem sementara, gunakan persistent storage yang dipasang ke folder `data/`; tanpa persistent storage, data dapat hilang saat restart atau redeploy.

Untuk menjalankan secara lokal, buat file `.env` dari `.env.example`, isi variable yang diperlukan, lalu jalankan `npm ci` dan `npm start`. Jangan commit file `.env`.

## Discord setup

- Tambahkan bot ke server dengan scope `bot` dan `applications.commands`.
- Atur role/channel ID di environment variables.
- Gunakan `/setup-appeal` untuk mengirim panel pengajuan ke channel panel yang dikonfigurasi.
- Jalankan `npm run deploy` setelah menambah atau mengubah slash commands.

Jika token pernah terunggah ke GitHub, segera reset token di Discord Developer Portal dan perbarui secret di Lunafy. Menghapus file dari commit terbaru tidak menghapusnya dari riwayat Git.
