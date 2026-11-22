const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { config } = require('../config');
const db = require('../database/db');
const logger = require('./logger');
const { sendAppealLog } = require('./appealLogger');

/**
 * Validasi apakah seorang member memiliki izin Staff/Owner
 */
function isStaff(member, guild) {
  if (!member) return false;
  // 1. Server Owner
  if (guild && guild.ownerId === member.id) return true;
  // 2. Administrator permission
  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  // 3. OWNER_ROLE_ID
  if (config.ownerRoleId && member.roles?.cache?.has(config.ownerRoleId)) return true;
  // 4. STAFF_ROLE_ID
  if (config.staffRoleId && member.roles?.cache?.has(config.staffRoleId)) return true;

  return false;
}

/**
 * Menghitung Member Rating berdasarkan usia akun Discord dan durasi di server
 */
function computeMemberRating(member) {
  if (!member) return 'N/A';

  const now = Date.now();
  // Usia akun dari Discord snowflake
  const accountCreatedAt = Number((BigInt(member.user?.id || member.id) >> 22n) + 1420070400000n);
  const accountAgeDays = Math.floor((now - accountCreatedAt) / 86400000);

  // Durasi bergabung di server
  const joinedAt = member.joinedTimestamp || 0;
  const serverAgeDays = joinedAt ? Math.floor((now - joinedAt) / 86400000) : 0;

  let score = 0;
  if (accountAgeDays > 365) score += 2;
  else if (accountAgeDays > 180) score += 1;

  if (serverAgeDays > 90) score += 2;
  else if (serverAgeDays > 30) score += 1;

  score = Math.min(score, 5);
  const stars = '⭐'.repeat(score) + '☆'.repeat(5 - score);
  return `${stars} (${score}/5) · Akun: ${accountAgeDays}h · Server: ${serverAgeDays}h`;
}

/**
 * Membangun Embed pesan Staff/Public sesuai status, voting, dan riwayat warning
 */
function buildStaffEmbed(appeal, voteCounts = null) {
  const votes = voteCounts || db.getVoteCounts(appeal.id);
  const total = votes.total || 0;
  const supportPct = total > 0 ? Math.round((votes.support / total) * 100) : 0;
  const againstPct = total > 0 ? Math.round((votes.against / total) * 100) : 0;
  const warningCount = db.getWarningCount(appeal.id);
  let screenshotUrl = null;

  if (appeal.screenshot_url) {
    try {
      const parsedScreenshotUrl = new URL(appeal.screenshot_url);
      if (parsedScreenshotUrl.protocol === 'https:' || parsedScreenshotUrl.protocol === 'http:') {
        screenshotUrl = parsedScreenshotUrl.href;
      }
    } catch {
      // An invalid screenshot link must not prevent the appeal from reaching staff.
    }
  }

  let color = 0xf1c40f; // Gold / Pending
  let statusText = '`🔎 Under Review`';

  if (appeal.status === 'APPROVED') {
    color = 0x2ecc71; // Green
    statusText = '`✅ Approved`';
  } else if (appeal.status === 'REJECTED') {
    color = 0xe74c3c; // Red
    statusText = '`❌ Rejected`';
  }

  const robloxName = appeal.roblox_username || appeal.ign || '-';

  const fields = [
    {
      name: '👤 Pengaju',
      value: `<@${appeal.user_id}> (${appeal.user_tag})\nID: \`${appeal.user_id}\``,
      inline: true,
    },
    {
      name: '🎮 Roblox Username',
      value: `**${robloxName}**`,
      inline: true,
    },
    {
      name: '📌 Status Pengajuan',
      value: statusText,
      inline: true,
    },
    {
      name: '📝 Alasan Bergabung',
      value: (appeal.reason || '-').slice(0, 1024),
      inline: false,
    },
  ];

  // Info tambahan jika ada
  const extraInfo = appeal.extra_info && appeal.extra_info !== '-' ? appeal.extra_info : null;
  if (extraInfo) {
    fields.push({
      name: '📊 Informasi Tambahan (GS / Level / Aktivitas)',
      value: extraInfo.slice(0, 1024),
      inline: false,
    });
  }

  // Member Rating
  if (appeal.member_rating) {
    fields.push({
      name: '⭐ Member Rating',
      value: appeal.member_rating,
      inline: false,
    });
  }

  // Community Voting dengan countdown jika masih pending
  let votingValue =
    `👍 **Support:** ${votes.support} (${supportPct}%)   •   👎 **Against:** ${votes.against} (${againstPct}%)\n` +
    `*Total Partisipasi Komunitas:* ${total} suara`;

  if (appeal.status === 'PENDING_REVIEW' && appeal.vote_ends_at) {
    const isVotingOpen = Date.now() < appeal.vote_ends_at;
    const voteEndTs = Math.floor(appeal.vote_ends_at / 1000);
    votingValue += isVotingOpen
      ? `\n⏳ Voting berakhir <t:${voteEndTs}:R>`
      : `\n🔒 Voting ditutup <t:${voteEndTs}:R>`;
  }

  fields.push({
    name: '🗳️ Community Voting',
    value: votingValue,
    inline: false,
  });

  // Tampilkan riwayat warning jika pernah diberikan
  if (warningCount > 0) {
    fields.push({
      name: '⚠️ Riwayat Warning',
      value: `Pemohon telah menerima **${warningCount}** peringatan dari staff.`,
      inline: false,
    });
  }

  // Tampilkan detail screenshot
  fields.push({
    name: '🖼️ In-Game Profile Screenshot',
    value: screenshotUrl
      ? `[Lihat Screenshot](${screenshotUrl})`
      : appeal.screenshot_url || '*Screenshot Terlampir*',
    inline: false,
  });

  // Tambahkan detail reviewer jika sudah diproses
  if (appeal.status === 'APPROVED' || appeal.status === 'REJECTED') {
    fields.push({
      name: '🛡️ Keputusan Resmi Staff',
      value: `<@${appeal.reviewed_by}> (ID: \`${appeal.reviewed_by}\`)\nWaktu: <t:${Math.floor(appeal.reviewed_at / 1000)}:F>`,
      inline: false,
    });
  }

  // Tambahkan alasan penolakan jika ditolak
  if (appeal.status === 'REJECTED' && appeal.rejection_reason) {
    fields.push({
      name: '📝 Alasan Penolakan',
      value: appeal.rejection_reason,
      inline: false,
    });
  }

  fields.push({
    name: '📅 Waktu Pengajuan',
    value: `<t:${Math.floor(appeal.created_at / 1000)}:F> (<t:${Math.floor(appeal.created_at / 1000)}:R>)`,
    inline: false,
  });

  const embed = new EmbedBuilder()
    .setTitle(`📋 Guild Join Appeal — ${appeal.appeal_code}`)
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: `Guild Join Appeal System • Appeal ID: ${appeal.appeal_code}` })
    .setTimestamp(new Date(appeal.created_at));

  if (screenshotUrl) {
    embed.setImage(screenshotUrl);
  }

  return embed;
}

/**
 * Membangun ActionRows: Row 1 Community Voting, Row 2 Staff Management
 */
function buildAppealActionRows(appealId, voteCounts = null, disabled = false) {
  const votes = voteCounts || db.getVoteCounts(appealId);

  // Row 1: Tombol Voting Publik untuk seluruh member
  const voteRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal_btn_vote_support_${appealId}`)
      .setLabel(`Support (${votes.support})`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👍')
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`appeal_btn_vote_against_${appealId}`)
      .setLabel(`Against (${votes.against})`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👎')
      .setDisabled(disabled),
  );

  // Row 2: Tombol Manage khusus Staff
  const staffRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal_btn_manage_${appealId}`)
      .setLabel('Manage')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⚙️')
      .setDisabled(disabled),
  );

  return [voteRow, staffRow];
}

async function updateAppealPost(client, appeal, voteCounts, disabled) {
  if (!appeal.channel_id || !appeal.message_id) {
    throw new Error(`Appeal ${appeal.appeal_code} is missing its channel or message ID`);
  }

  const channel = await client.channels.fetch(appeal.channel_id);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Appeal channel ${appeal.channel_id} is unavailable`);
  }

  const message = await channel.messages.fetch(appeal.message_id);
  return message.edit({
    embeds: [buildStaffEmbed(appeal, voteCounts)],
    components: buildAppealActionRows(appeal.id, voteCounts, disabled),
  });
}

/**
 * Mengirim notifikasi Direct Message ke pemohon sesuai template resmi
 */
async function sendApplicantDm(client, userId, appeal, decision, reason = null) {
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
      logger.warn(`User Discord ${userId} tidak ditemukan untuk notifikasi DM appeal ${appeal.appeal_code}.`);
      return false;
    }

    const dmEmbed = new EmbedBuilder().setTimestamp();

    if (decision === 'APPROVED') {
      dmEmbed
        .setTitle('JOIN APPEAL APPROVED')
        .setDescription(
          `Congratulations! Your Join Appeal (**${appeal.appeal_code}**) has been approved.\n\n` +
          'Your application has successfully passed the guild review.\n\n' +
          'Please follow all guild rules and contact the staff for further joining instructions.\n\n' +
          'Welcome to the guild!'
        )
        .setColor(0x2ecc71)
        .setFooter({ text: `Appeal ID: ${appeal.appeal_code}` });
    } else {
      dmEmbed
        .setTitle('JOIN APPEAL REJECTED')
        .setDescription(
          `Unfortunately, your Join Appeal (**${appeal.appeal_code}**) has been rejected.\n\n` +
          `**Reason:**\n${reason || 'Tidak ada alasan khusus yang dicantumkan.'}\n\n` +
          'Thank you for your interest in joining our guild.\n\n' +
          'You may contact the staff if you need clarification.'
        )
        .setColor(0xe74c3c)
        .setFooter({ text: `Appeal ID: ${appeal.appeal_code}` });
    }

    await user.send({ embeds: [dmEmbed] });
    logger.info(`Notifikasi DM appeal ${appeal.appeal_code} berhasil dikirim ke ${user.tag} (${userId})`);
    return true;
  } catch (error) {
    logger.warn(
      `Gagal mengirim DM notifikasi appeal ${appeal.appeal_code} ke user ${userId} (DM ditutup/dibatasi): ${error.message}`
    );
    return false;
  }
}

/**
 * Mengirim Warning resmi via DM ke pemohon
 */
async function sendWarningDm(client, userId, warningMessage, staffTag) {
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return false;

    const warnEmbed = new EmbedBuilder()
      .setTitle('📄 SURAT PERINGATAN GUILD')
      .setDescription(
        'Halo, member guild!\n\n' +
        'Anda menerima peringatan dari staff guild.\n\n' +
        '**Pesan Peringatan:**\n' +
        `${warningMessage}\n\n` +
        `**Dikirim oleh:** ${staffTag}\n\n` +
        'Mohon perhatikan peringatan ini dan penuhi persyaratan guild.'
      )
      .setColor(0xe67e22)
      .setTimestamp();

    await user.send({ embeds: [warnEmbed] });
    return true;
  } catch (error) {
    logger.warn(`Gagal mengirim DM warning ke user ${userId}: ${error.message}`);
    return false;
  }
}

/**
 * Membuat Modal Form Pendaftaran: Roblox Username, Screenshot URL, Alasan, Info Tambahan
 */
function createSimplifiedAppealModal() {
  const modal = new ModalBuilder()
    .setCustomId('appeal_modal_form')
    .setTitle('Guild Join Appeal Form');

  const robloxInput = new TextInputBuilder()
    .setCustomId('appeal_input_roblox_username')
    .setLabel('Roblox Username')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Masukkan username Roblox Anda (contoh: Builderman)')
    .setMinLength(3)
    .setMaxLength(50)
    .setRequired(true);

  const screenshotInput = new TextInputBuilder()
    .setCustomId('appeal_input_screenshot_url')
    .setLabel('Screenshot Profil In-Game (Link Publik)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Tempel link gambar publik; staff akan memeriksa screenshot.')
    .setMinLength(10)
    .setMaxLength(500)
    .setRequired(true);

  const alasanInput = new TextInputBuilder()
    .setCustomId('appeal_input_alasan')
    .setLabel('Alasan Ingin Bergabung')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Ceritakan alasan Anda ingin bergabung ke guild ini...')
    .setMinLength(10)
    .setMaxLength(500)
    .setRequired(true);

  const infoTambahanInput = new TextInputBuilder()
    .setCustomId('appeal_input_info_tambahan')
    .setLabel('Info Tambahan: GS / Level / Aktivitas')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Contoh: GS 8500, Level 85, aktif setiap hari...')
    .setMaxLength(300)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(robloxInput),
    new ActionRowBuilder().addComponents(screenshotInput),
    new ActionRowBuilder().addComponents(alasanInput),
    new ActionRowBuilder().addComponents(infoTambahanInput),
  );

  return modal;
}

/**
 * Handler untuk interaksi Button terkait alur Appeal Pengguna (Rules Agreement)
 */
async function handleAppealButton(interaction) {
  const { customId } = interaction;

  // 1. Tombol 'Make a Join Appeal' pada panel utama
  if (customId === 'appeal_btn_start') {
    const existingActive = db.getActiveAppealByUser(interaction.user.id);
    if (existingActive) {
      return interaction.reply({
        content: `⚠️ Anda sudah memiliki permohonan aktif yang sedang ditinjau (**${existingActive.appeal_code}**).\nHarap menunggu hasil peninjauan sebelum mengajukan kembali.`,
        ephemeral: true,
      });
    }

    const rulesEmbed = new EmbedBuilder()
      .setTitle('📜 GUILD MEMBERSHIP RULES')
      .setDescription(
        'Harap membaca seluruh peraturan keanggotaan guild berikut sebelum melanjutkan:\n\n' +
        '**1. Weekly Guild XP**\n' +
        'Setiap anggota wajib memperoleh minimal 5.000 Guild XP per minggu.\n' +
        'Jika mengalami kendala atau masalah tertentu, silakan hubungi Owner melalui DM.\n\n' +
        '**2. Daily Donation**\n' +
        'Setiap anggota wajib melakukan donasi kepada guild setiap hari.\n\n' +
        '**3. Guild Raid**\n' +
        'Anggota diharapkan selalu berpartisipasi dalam kegiatan Guild Raid.\n\n' +
        '**4. Boss Raid Schedule**\n' +
        'Boss Raid dilaksanakan empat kali sehari:\n' +
        '• 06.30 — Morning Raid\n' +
        '• 12.30 — Afternoon Raid\n' +
        '• 18.30 — Evening Raid\n' +
        '• 19.30 — Night Raid\n\n' +
        '**5. Minimum GS Requirement**\n' +
        'Setiap anggota wajib memiliki minimal 6.000+ GS.\n\n' +
        '**6. Activity Requirement**\n' +
        'Anggota tidak diperbolehkan offline atau tidak aktif selama lebih dari 3 hari berturut-turut tanpa pemberitahuan atau alasan yang jelas kepada Owner.\n\n' +
        '⚠️ **Apakah Anda menyetujui seluruh peraturan di atas dan siap berkomitmen?**'
      )
      .setColor(0xf1c40f)
      .setFooter({ text: 'Langkah 1/2: Persetujuan Rules Guild' });

    const rulesRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('appeal_btn_rules_agree')
        .setLabel('I Agree & Continue')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId('appeal_btn_rules_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️'),
    );

    return interaction.reply({
      embeds: [rulesEmbed],
      components: [rulesRow],
      ephemeral: true,
    });
  }

  // 2. Tombol 'Cancel' pada tahapan Rules
  if (customId === 'appeal_btn_rules_cancel') {
    return interaction.update({
      content: '❌ Pengajuan dibatalkan. Anda dapat menekan tombol pada panel kapan saja jika ingin memulai kembali.',
      embeds: [],
      components: [],
    });
  }

  // 3. Tombol 'I Agree & Continue' pada tahapan Rules -> Buka Simplified Modal
  if (customId === 'appeal_btn_rules_agree') {
    const existingActive = db.getActiveAppealByUser(interaction.user.id);
    if (existingActive) {
      return interaction.reply({
        content: `⚠️ Anda sudah memiliki permohonan aktif yang sedang ditinjau (**${existingActive.appeal_code}**).`,
        ephemeral: true,
      });
    }

    const modal = createSimplifiedAppealModal();
    return interaction.showModal(modal);
  }
}

/**
 * Handler untuk pengiriman Modal Form Appeal
 */
async function handleAppealModal(interaction) {
  if (interaction.customId === 'appeal_modal_form') {
    await interaction.deferReply({ ephemeral: true });

    const robloxUsername = interaction.fields.getTextInputValue('appeal_input_roblox_username').trim();
    const screenshotInput = interaction.fields.getTextInputValue('appeal_input_screenshot_url').trim();
    const alasan = (interaction.fields.getTextInputValue('appeal_input_alasan') || '').trim().slice(0, 500);
    const infoTambahan = (interaction.fields.getTextInputValue('appeal_input_info_tambahan') || '').trim().slice(0, 300) || '-';

    // Proteksi: appeal pending aktif
    const existingActive = db.getActiveAppealByUser(interaction.user.id);
    if (existingActive) {
      return interaction.editReply({
        content: `⚠️ Anda masih memiliki permohonan aktif yang sedang ditinjau (**${existingActive.appeal_code}**).\nHarap menunggu keputusan staff sebelum mengajukan permohonan baru.`,
      });
    }

    // Cooldown 2 hari dari pengajuan terakhir (apapun statusnya)
    const COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;
    const latestAppeal = db.getLatestAppealByUser(interaction.user.id);
    const isOwner =
      interaction.guild?.ownerId === interaction.user.id ||
      (config.ownerRoleId && interaction.member?.roles?.cache?.has(config.ownerRoleId));
    if (!isOwner && latestAppeal && latestAppeal.status !== 'PENDING_REVIEW') {
      const elapsed = Date.now() - latestAppeal.created_at;
      if (elapsed < COOLDOWN_MS) {
        const cooldownEndsAt = Math.floor((latestAppeal.created_at + COOLDOWN_MS) / 1000);
        return interaction.editReply({
          content: `⏳ Anda sedang dalam masa cooldown **2 hari** setelah pengajuan terakhir.\nAnda dapat mengajukan kembali <t:${cooldownEndsAt}:R> (<t:${cooldownEndsAt}:f>).`,
        });
      }
    }

    // Validasi konfigurasi channel
    const targetChannelId = config.guildAppealChannelId || config.staffChannelId;
    if (!targetChannelId || targetChannelId.trim() === '') {
      logger.error('GUILD_APPEAL_CHANNEL_ID belum dikonfigurasi pada file .env');
      return interaction.editReply({
        content: '⚠️ Channel pengajuan belum diatur oleh administrator server. Silakan hubungi staff guild.',
      });
    }

    let staffChannel = null;
    try {
      staffChannel = await interaction.client.channels.fetch(targetChannelId);
    } catch (fetchError) {
      logger.error(`Gagal mengambil GUILD_APPEAL_CHANNEL_ID (${targetChannelId}):`, fetchError);
    }

    if (!staffChannel || !staffChannel.isTextBased()) {
      return interaction.editReply({
        content: '❌ Channel pengajuan tidak ditemukan atau bot tidak memiliki izin akses.',
      });
    }

    // Hitung member rating
    const memberRating = computeMemberRating(interaction.member);

    // Simpan ke database
    let appeal;
    try {
      appeal = db.createAppeal({
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        robloxUsername,
        screenshotUrl: screenshotInput,
        reason: alasan,
        extraInfo: infoTambahan,
        rulesAgreed: 1,
        memberRating,
      });
    } catch (dbError) {
      logger.error('Gagal menyimpan appeal ke database SQLite:', dbError);
      return interaction.editReply({
        content: '❌ Terjadi kendala saat menyimpan data pengajuan Anda ke sistem database. Silakan coba lagi.',
      });
    }

    const initialVotes = { support: 0, against: 0, total: 0 };
    let staffEmbed;
    let actionRows;
    try {
      staffEmbed = buildStaffEmbed(appeal, initialVotes);
      actionRows = buildAppealActionRows(appeal.id, initialVotes, false);
    } catch (embedError) {
      logger.error(`Gagal membuat embed appeal ${appeal.appeal_code}:`, embedError);
      db.deleteUnsentAppeal(appeal.id);
      return interaction.editReply({
        content: '❌ Formulir tidak dapat diproses karena ada data yang tidak valid. Silakan periksa kembali dan kirim ulang.',
      });
    }

    let staffMessage;
    try {
      staffMessage = await staffChannel.send({
        embeds: [staffEmbed],
        components: actionRows,
      });
    } catch (sendError) {
      logger.error(`Gagal mengirim embed appeal ke channel ${staffChannel.id}:`, sendError);
      try {
        db.deleteUnsentAppeal(appeal.id);
      } catch (deleteError) {
        logger.error(`Gagal membersihkan appeal ${appeal.appeal_code} yang belum terkirim:`, deleteError);
      }
      return interaction.editReply({
        content: '⚠️ Formulir belum terkirim ke channel. Silakan coba kirim ulang atau hubungi staff.',
      });
    }

    try {
      db.updateAppealMessage(appeal.id, staffChannel.id, staffMessage.id);
    } catch (trackingError) {
      logger.error(`Pesan appeal terkirim tetapi gagal menyimpan ID pesannya (${appeal.appeal_code}):`, trackingError);
      return interaction.editReply({
        content: '⚠️ Formulir sudah terkirim ke channel, tetapi gagal memperbarui status pengiriman. Hubungi staff.',
      });
    }

    logger.info(
      `Appeal ${appeal.appeal_code} (Roblox: ${robloxUsername}) dikirim ke GUILD_APPEAL_CHANNEL_ID (Msg ID: ${staffMessage.id})`
    );

    await sendAppealLog(interaction.client, {
      title: 'Pengajuan Baru Diterima',
      color: 0x3498db,
      fields: [
        { name: '📋 Appeal ID', value: appeal.appeal_code, inline: true },
        { name: '👤 Pengaju', value: `<@${appeal.user_id}> (${appeal.user_tag})`, inline: true },
        { name: '🎮 Roblox Username', value: robloxUsername, inline: true },
        { name: '📝 Alasan', value: alasan.slice(0, 500), inline: false },
        { name: '🖼️ Screenshot', value: screenshotInput, inline: false },
      ],
    });

    const userConfirmEmbed = new EmbedBuilder()
      .setTitle('✅ Permohonan Bergabung Berhasil Dikirim')
      .setDescription(
        `Terima kasih **${interaction.user.username}**, formulir Anda telah berhasil kami terima!\n\n` +
        `• **Appeal ID:** ${appeal.appeal_code}\n` +
        `• **Roblox Username:** ${robloxUsername}\n` +
        '• **Screenshot Profil:** Link diterima; screenshot akan diperiksa staff.\n\n' +
        '⚠️ **Peringatan:** Pastikan memakai link gambar publik. Screenshot yang tidak dapat dibuka atau tidak sesuai dapat ditolak oleh staff.\n\n' +
        'Pengajuan Anda telah diteruskan ke channel komunitas untuk evaluasi dan voting.\n\n' +
        '📌 **Catatan:** Selama permohonan berstatus `Under Review`, Anda tidak dapat mengirimkan permohonan baru.'
      )
      .setColor(0x2ecc71)
      .setFooter({ text: `Appeal ID: ${appeal.appeal_code}` })
      .setTimestamp();

    return interaction.editReply({
      embeds: [userConfirmEmbed],
    });
  }
}

/**
 * Handler untuk interaksi Button Public Community Voting
 */
async function handleCommunityVoteButton(interaction) {
  const { customId, user } = interaction;

  const isSupport = customId.startsWith('appeal_btn_vote_support_');
  const voteType = isSupport ? 'SUPPORT' : 'AGAINST';
  const appealId = Number(
    customId.replace(isSupport ? 'appeal_btn_vote_support_' : 'appeal_btn_vote_against_', '')
  );

  if (!appealId || isNaN(appealId)) {
    return interaction.reply({
      content: '❌ ID permohonan tidak valid.',
      ephemeral: true,
    });
  }

  const appeal = db.getAppealById(appealId);
  if (!appeal) {
    return interaction.reply({
      content: '❌ Data permohonan tidak ditemukan.',
      ephemeral: true,
    });
  }

  if (appeal.status !== 'PENDING_REVIEW') {
    return interaction.reply({
      content: `⚠️ Voting telah ditutup karena permohonan ini sudah selesai diproses (**${appeal.status}**).`,
      ephemeral: true,
    });
  }

  // Cek apakah periode voting masih terbuka (24 jam)
  if (appeal.vote_ends_at && Date.now() > appeal.vote_ends_at) {
    return interaction.reply({
      content: `🔒 Periode voting untuk permohonan ini telah berakhir. Keputusan akhir ada di tangan Staff.`,
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();

  const voteResult = db.castVote(appealId, user.id, voteType);
  const updatedVotes = db.getVoteCounts(appealId);

  await interaction.editReply({
    embeds: [buildStaffEmbed(appeal, updatedVotes)],
    components: buildAppealActionRows(appealId, updatedVotes, false),
  });

  let feedback = '';
  if (!voteResult.changed) {
    feedback = `ℹ️ Anda sudah memberikan vote **${voteType === 'SUPPORT' ? '👍 Support' : '👎 Against'}** pada permohonan ini.`;
  } else if (voteResult.previousVote) {
    feedback = `🔄 Pilihan vote Anda pada permohonan **${appeal.appeal_code}** berhasil diubah menjadi **${voteType === 'SUPPORT' ? '👍 Support' : '👎 Against'}**.`;
  } else {
    feedback = `✅ Vote Anda pada permohonan **${appeal.appeal_code}** berhasil dicatat: **${voteType === 'SUPPORT' ? '👍 Support' : '👎 Against'}**.`;
  }

  logger.info(
    `[COMMUNITY VOTE] User ${user.tag} (${user.id}) voted ${voteType} on appeal ${appeal.appeal_code} (Support: ${updatedVotes.support}, Against: ${updatedVotes.against})`
  );

  return interaction.followUp({
    content: feedback,
    ephemeral: true,
  });
}

/**
 * Handler untuk tombol Manage dan aksi staff pada pesan appeal lama
 */
async function handleStaffReviewButton(interaction) {
  const { customId, member, guild, user } = interaction;
  const isStatusMenu = customId.startsWith('appeal_select_status_');

  // 1. Validasi Izin Staff (Khusus Staff / Owner / Admin)
  if (!isStaff(member, guild)) {
    return interaction.reply({
      content: '⛔ Anda tidak memiliki izin untuk mengambil tindakan resmi pada permohonan ini.',
      ephemeral: true,
    });
  }

  // Parse customId
  let action = '';
  let appealId = null;

  if (customId.startsWith('appeal_btn_manage_')) {
    action = 'MANAGE';
    appealId = Number(customId.replace('appeal_btn_manage_', ''));
  } else if (isStatusMenu) {
    action = interaction.values?.[0];
    appealId = Number(customId.replace('appeal_select_status_', ''));
  } else if (customId.startsWith('appeal_btn_approve_')) {
    action = 'APPROVE';
    appealId = Number(customId.replace('appeal_btn_approve_', ''));
  } else if (customId.startsWith('appeal_btn_reject_')) {
    action = 'REJECT';
    appealId = Number(customId.replace('appeal_btn_reject_', ''));
  } else if (customId.startsWith('appeal_btn_warn_')) {
    action = 'WARN';
    appealId = Number(customId.replace('appeal_btn_warn_', ''));
  }

  if (!appealId || isNaN(appealId)) {
    return interaction.reply({
      content: '❌ ID permohonan tidak valid.',
      ephemeral: true,
    });
  }

  const appeal = db.getAppealById(appealId);
  if (!appeal) {
    return interaction.reply({
      content: '❌ Data permohonan tidak ditemukan di database.',
      ephemeral: true,
    });
  }

  if (!['MANAGE', 'UNDER_REVIEW', 'APPROVE', 'REJECT', 'WARN'].includes(action)) {
    return interaction.reply({
      content: '❌ Aksi pengelolaan status tidak valid.',
      ephemeral: true,
    });
  }

  // Warning maupun Keputusan tidak boleh dilakukan jika appeal sudah selesai
  if (appeal.status !== 'PENDING_REVIEW') {
    return interaction.reply({
      content: `⚠️ Tindakan tidak dapat dilakukan karena permohonan ini sudah berstatus **${appeal.status}** oleh <@${appeal.reviewed_by}>.`,
      ephemeral: true,
    });
  }

  if (action === 'MANAGE') {
    const statusMenu = new StringSelectMenuBuilder()
      .setCustomId(`appeal_select_status_${appealId}`)
      .setPlaceholder('Pilih status pengajuan')
      .addOptions(
        { label: 'Under Review', value: 'UNDER_REVIEW', description: 'Pengajuan masih ditinjau staff' },
        { label: 'Approve', value: 'APPROVE', description: 'Setujui pengajuan secara final' },
        { label: 'Denied', value: 'REJECT', description: 'Tolak pengajuan secara final' },
      );

    return interaction.reply({
      content: `Kelola status **${appeal.appeal_code}**. Status final tidak dapat diubah.`,
      components: [new ActionRowBuilder().addComponents(statusMenu)],
      ephemeral: true,
    });
  }

  if (action === 'UNDER_REVIEW') {
    return interaction.update({
      content: `🔎 **${appeal.appeal_code}** tetap berstatus **Under Review**.`,
      components: [],
    });
  }

  // 2. Aksi APPROVE
  if (action === 'APPROVE') {
    await interaction.deferUpdate();

    const reviewResult = db.reviewAppeal(appealId, 'APPROVED', user.id);
    if (!reviewResult.success) {
      const response = {
        content: `⚠️ Permohonan ini baru saja diproses oleh staff lain dengan status **${reviewResult.appeal?.status}**.`,
        components: [],
      };
      return isStatusMenu ? interaction.editReply(response) : interaction.followUp({ ...response, ephemeral: true });
    }

    const updatedAppeal = reviewResult.appeal;
    const finalVotes = db.getVoteCounts(appealId);

    if (isStatusMenu) {
      try {
        await updateAppealPost(interaction.client, updatedAppeal, finalVotes, true);
      } catch (editError) {
        logger.error(`Gagal memperbarui pesan appeal ${updatedAppeal.appeal_code} setelah disetujui:`, editError);
      }
    } else {
      await interaction.editReply({
        embeds: [buildStaffEmbed(updatedAppeal, finalVotes)],
        components: buildAppealActionRows(appealId, finalVotes, true),
      });
    }

    logger.info(
      `[STAFF DECISION] Appeal ${updatedAppeal.appeal_code} APPROVED by ${user.tag} (${user.id})`
    );

    const dmSentApprove = await sendApplicantDm(interaction.client, updatedAppeal.user_id, updatedAppeal, 'APPROVED');

    // Audit log
    await sendAppealLog(interaction.client, {
      title: '✅ Appeal Disetujui',
      color: 0x2ecc71,
      fields: [
        { name: '📋 Appeal ID', value: updatedAppeal.appeal_code, inline: true },
        { name: '🎮 Roblox', value: updatedAppeal.roblox_username || updatedAppeal.ign || '-', inline: true },
        { name: '👤 Pengaju', value: `<@${updatedAppeal.user_id}>`, inline: true },
        { name: '🛡️ Disetujui Oleh', value: `<@${user.id}> (${user.tag})`, inline: false },
        { name: '📩 DM Notifikasi', value: dmSentApprove ? '✅ Terkirim' : '❌ Gagal (DM tertutup)', inline: false },
      ],
    });

    const response = {
      content: `✅ Permohonan **${updatedAppeal.appeal_code}** (${updatedAppeal.roblox_username || updatedAppeal.ign}) berhasil disetujui secara resmi.`,
      components: [],
    };
    return isStatusMenu ? interaction.editReply(response) : interaction.followUp({ ...response, ephemeral: true });
  }

  // 3. Aksi REJECT: Tampilkan Modal Alasan Penolakan
  if (action === 'REJECT') {
    const rejectModal = new ModalBuilder()
      .setCustomId(`appeal_modal_reject_${appealId}`)
      .setTitle(`Tolak Appeal ${appeal.appeal_code}`);

    const reasonInput = new TextInputBuilder()
      .setCustomId('appeal_input_reject_reason')
      .setLabel('Alasan Penolakan')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Tuliskan alasan penolakan secara jelas...')
      .setMinLength(5)
      .setMaxLength(1000)
      .setRequired(true);

    rejectModal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(rejectModal);
  }

  // 4. Aksi SEND WARNING: Tampilkan Modal Input Pesan Warning
  if (action === 'WARN') {
    const warnModal = new ModalBuilder()
      .setCustomId(`appeal_modal_warn_${appealId}`)
      .setTitle(`Kirim Warning #${appeal.appeal_code}`);

    const warnInput = new TextInputBuilder()
      .setCustomId('appeal_input_warn_message')
      .setLabel('Warning Message')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Tuliskan pesan peringatan resmi yang akan dikirim via DM...')
      .setMinLength(5)
      .setMaxLength(1000)
      .setRequired(true);

    warnModal.addComponents(new ActionRowBuilder().addComponents(warnInput));
    return interaction.showModal(warnModal);
  }
}

/**
 * Handler untuk pengiriman Modal Reject oleh Staff
 */
async function handleStaffRejectModal(interaction) {
  const { customId, member, guild, user } = interaction;

  if (!isStaff(member, guild)) {
    return interaction.reply({
      content: '⛔ Anda tidak memiliki izin untuk meninjau permohonan ini.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const appealId = Number(customId.replace('appeal_modal_reject_', ''));
  const rejectionReason = interaction.fields.getTextInputValue('appeal_input_reject_reason');

  if (!appealId || isNaN(appealId)) {
    return interaction.editReply({ content: '❌ ID permohonan tidak valid.' });
  }

  const reviewResult = db.reviewAppeal(appealId, 'REJECTED', user.id, rejectionReason);
  if (!reviewResult.success) {
    return interaction.editReply({
      content: `⚠️ Permohonan ini sudah diproses sebelumnya dengan status **${reviewResult.appeal?.status}** oleh <@${reviewResult.appeal?.reviewed_by}>.`,
    });
  }

  const updatedAppeal = reviewResult.appeal;
  const finalVotes = db.getVoteCounts(appealId);

  if (updatedAppeal.channel_id && updatedAppeal.message_id) {
    try {
      const channel = await interaction.client.channels.fetch(updatedAppeal.channel_id);
      if (channel && channel.isTextBased()) {
        const staffMsg = await channel.messages.fetch(updatedAppeal.message_id).catch(() => null);
        if (staffMsg) {
          await staffMsg.edit({
            embeds: [buildStaffEmbed(updatedAppeal, finalVotes)],
            components: buildAppealActionRows(appealId, finalVotes, true),
          });
        }
      }
    } catch (msgErr) {
      logger.error(`Gagal memperbarui pesan embed appeal ${updatedAppeal.appeal_code}:`, msgErr);
    }
  }

  logger.info(
    `[STAFF DECISION] Appeal ${updatedAppeal.appeal_code} REJECTED by ${user.tag} (${user.id}) - Alasan: ${rejectionReason}`
  );

  const dmSentReject = await sendApplicantDm(interaction.client, updatedAppeal.user_id, updatedAppeal, 'REJECTED', rejectionReason);

  // Audit log
  await sendAppealLog(interaction.client, {
    title: '❌ Appeal Ditolak',
    color: 0xe74c3c,
    fields: [
      { name: '📋 Appeal ID', value: updatedAppeal.appeal_code, inline: true },
      { name: '🎮 Roblox', value: updatedAppeal.roblox_username || updatedAppeal.ign || '-', inline: true },
      { name: '👤 Pengaju', value: `<@${updatedAppeal.user_id}>`, inline: true },
      { name: '🛡️ Ditolak Oleh', value: `<@${user.id}> (${user.tag})`, inline: false },
      { name: '📝 Alasan Penolakan', value: rejectionReason, inline: false },
      { name: '📩 DM Notifikasi', value: dmSentReject ? '✅ Terkirim' : '❌ Gagal (DM tertutup)', inline: false },
    ],
  });

  return interaction.editReply({
    content: `❌ Permohonan **${updatedAppeal.appeal_code}** (${updatedAppeal.roblox_username || updatedAppeal.ign}) telah ditolak secara resmi.`,
  });
}

/**
 * Handler untuk pengiriman Modal Send Warning oleh Staff
 */
async function handleStaffWarnModal(interaction) {
  const { customId, member, guild, user } = interaction;

  if (!isStaff(member, guild)) {
    return interaction.reply({
      content: '⛔ Anda tidak memiliki izin untuk memberikan warning.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const appealId = Number(customId.replace('appeal_modal_warn_', ''));
  const warningMessage = interaction.fields.getTextInputValue('appeal_input_warn_message');

  if (!appealId || isNaN(appealId)) {
    return interaction.editReply({ content: '❌ ID permohonan tidak valid.' });
  }

  const appeal = db.getAppealById(appealId);
  if (!appeal) {
    return interaction.editReply({ content: '❌ Data permohonan tidak ditemukan.' });
  }

  if (appeal.status !== 'PENDING_REVIEW') {
    return interaction.editReply({
      content: `⚠️ Warning tidak dapat dikirim karena permohonan ini sudah berstatus **${appeal.status}**.`,
    });
  }

  // Kirim Warning via DM
  const dmSent = await sendWarningDm(interaction.client, appeal.user_id, warningMessage, user.tag);
  const deliveryStatus = dmSent ? 'SENT' : 'DELIVERY_FAILED';

  // Simpan riwayat warning ke SQLite
  db.addWarning(appealId, appeal.user_id, warningMessage, user.id, deliveryStatus);

  // Audit log
  await sendAppealLog(interaction.client, {
    title: '⚠️ Warning Dikirim ke Pemohon',
    color: 0xe67e22,
    fields: [
      { name: '📋 Appeal ID', value: appeal.appeal_code, inline: true },
      { name: '👤 Pengaju', value: `<@${appeal.user_id}>`, inline: true },
      { name: '🛡️ Dikirim Oleh', value: `<@${user.id}> (${user.tag})`, inline: false },
      { name: '📝 Pesan Warning', value: warningMessage, inline: false },
      { name: '📩 DM Status', value: dmSent ? '✅ Terkirim' : '❌ Gagal (DM tertutup)', inline: false },
    ],
  });

  if (!dmSent) {
    logger.warn(`Warning untuk appeal ${appeal.appeal_code} gagal dikirim via DM ke user ${appeal.user_id}.`);
    return interaction.editReply({
      content: `⚠️ Pesan peringatan dicatat di database, namun **gagal dikirimkan ke pemohon via DM** (Direct Messages ditutup/diblokir).`,
    });
  }

  // Perbarui embed di STAFF_CHANNEL_ID agar jumlah warning ter-update
  if (appeal.channel_id && appeal.message_id) {
    try {
      const channel = await interaction.client.channels.fetch(appeal.channel_id);
      if (channel && channel.isTextBased()) {
        const staffMsg = await channel.messages.fetch(appeal.message_id).catch(() => null);
        if (staffMsg) {
          const votes = db.getVoteCounts(appealId);
          await staffMsg.edit({
            embeds: [buildStaffEmbed(appeal, votes)],
            components: buildAppealActionRows(appealId, votes, false),
          });
        }
      }
    } catch (err) {
      logger.error(`Gagal mengupdate embed setelah warning dikirim:`, err);
    }
  }

  logger.info(
    `[STAFF WARNING] Appeal ${appeal.appeal_code} received warning from ${user.tag} (${user.id}): "${warningMessage}"`
  );

  return interaction.editReply({
    content: `⚠️ Warning resmi berhasil dikirim ke <@${appeal.user_id}> via DM. (Status permohonan tetap Under Review).`,
  });
}

module.exports = {
  createSimplifiedAppealModal,
  handleAppealButton,
  handleAppealModal,
  handleCommunityVoteButton,
  handleStaffReviewButton,
  handleStaffRejectModal,
  handleStaffWarnModal,
  buildStaffEmbed,
  buildAppealActionRows,
  isStaff,
  sendApplicantDm,
  sendWarningDm,
};
