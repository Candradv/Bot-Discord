const { SlashCommandBuilder } = require('discord.js');
const { isStaff, sendWarningDm } = require('../utils/appealInteractions');
const { sendAppealLog } = require('../utils/appealLogger');

const REQUIREMENTS = [
  { name: 'Weekly Guild XP (minimum 5.000/minggu)', value: 'Weekly Guild XP' },
  { name: 'Daily Donation', value: 'Daily Donation' },
  { name: 'Guild Raid', value: 'Guild Raid' },
  { name: 'Boss Raid Schedule', value: 'Boss Raid Schedule' },
  { name: 'Minimum GS (6.000+)', value: 'Minimum GS Requirement' },
  { name: 'Activity (maksimal 3 hari offline)', value: 'Activity Requirement' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guild-warning')
    .setDescription('Kirim peringatan persyaratan guild kepada member')
    .addUserOption((option) =>
      option.setName('member').setDescription('Member yang perlu diperingatkan').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('requirement')
        .setDescription('Persyaratan guild yang perlu diperhatikan')
        .setRequired(true)
        .addChoices(...REQUIREMENTS),
    )
    .addStringOption((option) =>
      option
        .setName('catatan')
        .setDescription('Catatan tambahan untuk member (opsional)')
        .setMaxLength(700)
        .setRequired(false),
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'Perintah ini hanya dapat digunakan di dalam server Discord.',
        ephemeral: true,
      });
    }

    if (!isStaff(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: '⛔ Hanya staff, owner, atau administrator yang dapat mengirim warning.',
        ephemeral: true,
      });
    }

    const member = interaction.options.getUser('member');
    const requirement = interaction.options.getString('requirement');
    const note = interaction.options.getString('catatan')?.trim();
    if (member.bot) {
      return interaction.reply({
        content: 'Pilih akun member, bukan bot.',
        ephemeral: true,
      });
    }

    const warningMessage =
      `**Persyaratan yang perlu diperhatikan:** ${requirement}.\n\n` +
      'Progres Anda sudah mendekati batas minimum persyaratan guild. Ini merupakan surat peringatan resmi; ' +
      'mohon segera melakukan perbaikan. Jika ada kendala, segera hubungi staff guild.\n\n' +
      'Jika pada evaluasi berikutnya persyaratan tetap tidak terpenuhi, staff dapat mengeluarkan (kick) Anda dari guild. ' +
      'Kick tidak dilakukan otomatis oleh bot.' +
      (note ? `\n\n**Catatan staff:** ${note}` : '');

    await interaction.deferReply({ ephemeral: true });

    const dmSent = await sendWarningDm(client, member.id, warningMessage, interaction.user.tag);
    await sendAppealLog(client, {
      title: '📄 Surat Peringatan Guild',
      color: 0xe67e22,
      fields: [
        { name: '👤 Member', value: `<@${member.id}> (${member.tag})`, inline: true },
        { name: '📋 Persyaratan', value: requirement, inline: true },
        { name: '🛡️ Dikirim Oleh', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
        { name: '📩 Status DM', value: dmSent ? '✅ Terkirim' : '❌ Gagal (DM tertutup)', inline: false },
      ],
    });

    return interaction.editReply({
      content: dmSent
        ? `✅ Surat peringatan untuk **${member.tag}** berhasil dikirim via DM.`
        : `⚠️ Surat peringatan dicatat, tetapi DM ke **${member.tag}** gagal dikirim (mungkin DM tertutup).`,
    });
  },
};
