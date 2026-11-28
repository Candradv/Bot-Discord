const { SlashCommandBuilder } = require('discord.js');
const { config } = require('../config');
const { isStaff } = require('../utils/appealInteractions');
const { RAIDS, sendRaidNotification } = require('../utils/raidScheduler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notiftest')
    .setDescription('Uji coba kirim pesan notifikasi reminder Boss Raid')
    .addIntegerOption((option) =>
      option
        .setName('menit')
        .setDescription('Pilih waktu reminder pengingat')
        .setRequired(false)
        .addChoices(
          { name: '10 Menit Sebelum', value: 10 },
          { name: '5 Menit Sebelum', value: 5 },
          { name: '1 Menit Sebelum', value: 1 },
          { name: '0 Menit (Raid Dimulai)', value: 0 },
        )
    )
    .addStringOption((option) =>
      option
        .setName('raid')
        .setDescription('Pilih jadwal raid yang ingin diuji')
        .setRequired(false)
        .addChoices(
          { name: '🌅 Morning Raid (06:30)', value: 'morning' },
          { name: '☀️ Afternoon Raid (12:30)', value: 'afternoon' },
          { name: '🌆 Evening Raid (18:30)', value: 'evening' },
          { name: '🌙 Night Raid (19:30)', value: 'night' },
        )
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'Perintah ini hanya dapat dijalankan di dalam server Discord.',
        ephemeral: true,
      });
    }

    // Hanya Staff/Owner yang bisa menjalankan uji coba
    if (!isStaff(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: '⛔ Anda tidak memiliki izin untuk menjalankan perintah uji coba ini.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const minutesBefore = interaction.options.getInteger('menit') ?? 10;
    const raidId = interaction.options.getString('raid') || 'morning';
    const selectedRaid = RAIDS.find((r) => r.id === raidId) || RAIDS[0];

    // Buat target waktu simulasi
    const targetUnix = Math.floor(Date.now() / 1000) + minutesBefore * 60;

    const success = await sendRaidNotification(client, {
      raid: selectedRaid,
      targetUnix,
      minutesBefore,
      isTest: true,
    });

    if (success) {
      return interaction.editReply({
        content: `✅ **Notifikasi uji coba berhasil dikirim!**\n\n• **Raid:** ${selectedRaid.icon} ${selectedRaid.name}\n• **Kategori:** ${minutesBefore === 0 ? 'Raid Dimulai Sekarang' : `${minutesBefore} Menit Sebelum`}\n• **Channel Tujuan:** <#${config.raidReminderChannelId}>\n• **Role Tag:** <@&${config.raidReminderRoleId}>`,
      });
    } else {
      return interaction.editReply({
        content: `❌ Gagal mengirim notifikasi uji coba. Pastikan channel <#${config.raidReminderChannelId}> dapat diakses oleh bot.`,
      });
    }
  },
};
