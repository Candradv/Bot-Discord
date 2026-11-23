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
const MINIMUM_GEAR_SCORE = 6000;

/**
 * Validasi apakah seorang member memiliki izin Staff/Owner
 */
function isOwnerOrAdmin(member, guild) {
  if (!member) return false;
  if (guild && guild.ownerId === member.id) return true;
  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  return Boolean(config.ownerRoleId && member.roles?.cache?.has(config.ownerRoleId));
}

function isStaff(member, guild) {
  if (isOwnerOrAdmin(member, guild)) return true;
  return Boolean(config.staffRoleId && member?.roles?.cache?.has(config.staffRoleId));
}

function isAppealOwner(interaction) {
  return (
    interaction.guild?.ownerId === interaction.user.id ||
    (config.ownerRoleId && interaction.member?.roles?.cache?.has(config.ownerRoleId))
  );
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
  return `${stars} (${score}/5) · Account: ${accountAgeDays}d · Server: ${serverAgeDays}d`;
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
  const gearScore = Number.isSafeInteger(appeal.gear_score) ? appeal.gear_score : null;

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
      name: '👤 Applicant',
      value: `<@${appeal.user_id}> (${appeal.user_tag})\nID: \`${appeal.user_id}\``,
      inline: true,
    },
    {
      name: '🎮 Roblox Username',
      value: `**${robloxName}**`,
      inline: true,
    },
    {
      name: '⚔️ Gear Score',
      value: gearScore === null
        ? '*Not provided*'
        : `**${gearScore.toLocaleString('en-US')} GS**${gearScore < MINIMUM_GEAR_SCORE ? '\n⚠️ Below the 6,000 GS minimum' : ''}`,
      inline: true,
    },
    {
      name: '📸 Gear Score Proof',
      value: appeal.screenshot_url
        ? 'Image received via DM — compare it with the submitted GS.'
        : 'Waiting for the applicant to send the Gear Score screenshot via DM.',
      inline: true,
    },
    {
      name: '📌 Application Status',
      value: statusText,
      inline: true,
    },
    {
      name: '📝 Reason for Joining',
      value: (appeal.reason || '-').slice(0, 1024),
      inline: false,
    },
  ];

  // Additional information, if provided
  const extraInfo = appeal.extra_info && appeal.extra_info !== '-' ? appeal.extra_info : null;
  if (extraInfo) {
    fields.push({
      name: '📊 Additional Information (Level / Activity)',
      value: extraInfo.slice(0, 1024),
      inline: false,
    });
  }

  if (appeal.roblox_experience) {
    fields.push({
      name: '🕹️ The Forge Play Schedule',
      value: appeal.roblox_experience.slice(0, 1024),
      inline: false,
    });
  }

  // Member rating
  if (appeal.member_rating) {
    fields.push({
      name: '⭐ Member Rating',
      value: appeal.member_rating,
      inline: false,
    });
  }

  // Community voting with a countdown while under review
  let votingValue =
    `👍 **Support:** ${votes.support} (${supportPct}%)   •   👎 **Against:** ${votes.against} (${againstPct}%)\n` +
    `*Total community votes:* ${total}`;

  if (appeal.status === 'PENDING_REVIEW' && appeal.vote_ends_at) {
    const isVotingOpen = Date.now() < appeal.vote_ends_at;
    const voteEndTs = Math.floor(appeal.vote_ends_at / 1000);
    votingValue += isVotingOpen
      ? `\n⏳ Voting ends <t:${voteEndTs}:R>`
      : `\n🔒 Voting closed <t:${voteEndTs}:R>`;
  }

  fields.push({
    name: '🗳️ Community Voting',
    value: votingValue,
    inline: false,
  });

  // Show warning history, if any
  if (warningCount > 0) {
    fields.push({
      name: '⚠️ Warning History',
      value: `The applicant has received **${warningCount}** staff warning(s).`,
      inline: false,
    });
  }

  if (appeal.permanent_block) {
    fields.push({
      name: '🛡️ Gear Score Verification',
      value: 'Staff manually verified a mismatch and applied a permanent appeal block at the time of this denial.',
      inline: false,
    });
  }

  // Show reviewer details after a final decision
  if (appeal.status === 'APPROVED' || appeal.status === 'REJECTED') {
    fields.push({
      name: '🛡️ Official Staff Decision',
      value: `<@${appeal.reviewed_by}> (ID: \`${appeal.reviewed_by}\`)\nTime: <t:${Math.floor(appeal.reviewed_at / 1000)}:F>`,
      inline: false,
    });
  }

  // Show rejection reason
  if (appeal.status === 'REJECTED' && appeal.rejection_reason) {
    fields.push({
      name: '📝 Rejection Reason',
      value: appeal.rejection_reason,
      inline: false,
    });
  }

  fields.push({
    name: '📅 Application Date',
    value: `<t:${Math.floor(appeal.created_at / 1000)}:F> (<t:${Math.floor(appeal.created_at / 1000)}:R>)`,
    inline: false,
  });

  const embed = new EmbedBuilder()
    .setTitle(`📋 Guild Join Appeal — ${appeal.appeal_code}`)
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: `Guild Join Appeal System • Appeal ID: ${appeal.appeal_code}` })
    .setTimestamp(new Date(appeal.created_at));

  if (appeal.screenshot_url) {
    embed.setImage(appeal.screenshot_url);
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
          `**Reason:**\n${reason || 'No specific reason was provided.'}\n\n` +
          'Thank you for your interest in joining our guild.\n\n' +
          'You may contact the staff if you need clarification.' +
          (appeal.permanent_block
            ? '\n\n⛔ Staff verified that your actual Gear Score did not match the value in your application. You are permanently blocked from submitting future appeals.'
            : '')
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

async function sendGearScoreScreenshotDm(client, userId, appeal) {
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return false;

    const dmEmbed = new EmbedBuilder()
      .setTitle('📸 Gear Score Verification')
      .setDescription(
        `Please send a **clear screenshot/image of your Gear Score** for appeal **${appeal.appeal_code}**.\n\n` +
        'Staff will compare the image with the Gear Score value submitted in your application.\n\n' +
        '**Reply directly to this DM** with a screenshot of your current Gear Score. Accepted formats: PNG, JPG, JPEG, WEBP, or GIF.'
      )
      .setColor(0xf1c40f)
      .setFooter({ text: `Appeal ID: ${appeal.appeal_code}` })
      .setTimestamp();

    await user.send({ embeds: [dmEmbed] });
    return true;
  } catch (error) {
    logger.warn(`Gagal mengirim permintaan screenshot Gear Score via DM ke user ${userId}: ${error.message}`);
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
      .setTitle('📄 Guild Warning')
      .setDescription(
        'You received an official warning from guild staff.\n\n' +
        '**Warning:**\n' +
        `${warningMessage}\n\n` +
        `**Sent by:** ${staffTag}`
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
 * Build the guild appeal form modal.
 */
function createSimplifiedAppealModal() {
  const modal = new ModalBuilder()
    .setCustomId('appeal_modal_form')
    .setTitle('Guild Join Appeal Form');

  const robloxInput = new TextInputBuilder()
    .setCustomId('appeal_input_roblox_username')
    .setLabel('Roblox Username')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter your Roblox username (e.g. Builderman)')
    .setMinLength(3)
    .setMaxLength(50)
    .setRequired(true);

  const gearScoreInput = new TextInputBuilder()
    .setCustomId('appeal_input_gear_score')
    .setLabel('What is your Gear Score (GS)?')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter your current GS as a whole number (e.g. 6500)')
    .setMinLength(1)
    .setMaxLength(9)
    .setRequired(true);

  const alasanInput = new TextInputBuilder()
    .setCustomId('appeal_input_alasan')
    .setLabel('Reason for Joining')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Tell us why you want to join this guild...')
    .setMinLength(10)
    .setMaxLength(500)
    .setRequired(true);

  const infoTambahanInput = new TextInputBuilder()
    .setCustomId('appeal_input_info_tambahan')
    .setLabel('Additional Information: Level / Activity')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('For example: Level 85, active every day...')
    .setMaxLength(300)
    .setRequired(false);

  const robloxExperienceInput = new TextInputBuilder()
    .setCustomId('appeal_input_roblox_experience')
    .setLabel('How often and how long do you play The Forge?')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Example: 12 hours daily, 2 days per week, or every other day')
    .setMinLength(2)
    .setMaxLength(200)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(robloxInput),
    new ActionRowBuilder().addComponents(gearScoreInput),
    new ActionRowBuilder().addComponents(alasanInput),
    new ActionRowBuilder().addComponents(infoTambahanInput),
    new ActionRowBuilder().addComponents(robloxExperienceInput),
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
    const permanentBlock = db.getPermanentAppealBlockByUser(interaction.user.id);
    if (permanentBlock) {
      return interaction.reply({
        content: '⛔ You are permanently blocked from submitting future appeals because staff verified that your actual Gear Score did not match your submitted value.',
        ephemeral: true,
      });
    }

    const existingActive = db.getActiveAppealByUser(interaction.user.id);
    if (existingActive && !isAppealOwner(interaction)) {
      return interaction.reply({
        content: `⚠️ You already have an active appeal under review (**${existingActive.appeal_code}**). Please wait for the staff decision before submitting another.`,
        ephemeral: true,
      });
    }

    const rulesEmbed = new EmbedBuilder()
      .setTitle('📜 GUILD MEMBERSHIP RULES')
      .setDescription(
        'Please read all guild membership requirements before continuing:\n\n' +
        '**1. Weekly Guild XP**\n' +
        'Members must earn at least 5,000 Guild XP per week. Contact the Owner if you have a problem.\n\n' +
        '**2. Daily Donation**\n' +
        'Members must donate to the guild every day.\n\n' +
        '**3. Guild Raid**\n' +
        'Members are expected to participate in Guild Raids.\n\n' +
        '**4. Boss Raid Schedule**\n' +
        'Boss Raids take place four times a day (Western Indonesia Time / WIB):\n' +
        '• 06.30 — Morning Raid\n' +
        '• 12.30 — Afternoon Raid\n' +
        '• 18.30 — Evening Raid\n' +
        '• 19.30 — Night Raid\n\n' +
        '**5. Minimum GS Requirement**\n' +
        'Applicants must have at least 6,000 Gear Score (GS). After submitting, reply to the bot DM with a clear screenshot of your current Gear Score.\n\n' +
        '**6. Activity Requirement**\n' +
        'Members must not be inactive for more than 3 consecutive days without notifying the Owner.\n\n' +
        '⛔ **Important:** Staff will manually verify your actual Gear Score. If it does not match the value in your application and your appeal is denied for this mismatch, you will be permanently blocked from submitting future appeals.\n\n' +
        '⚠️ **Do you agree to these requirements and commit to following them?**'
      )
      .setColor(0xf1c40f)
      .setFooter({ text: 'Step 1/2: Guild Rules Agreement' });

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
      content: '❌ Application cancelled. You can use the panel to start again at any time.',
      embeds: [],
      components: [],
    });
  }

  // 3. Tombol 'I Agree & Continue' pada tahapan Rules -> Buka Simplified Modal
  if (customId === 'appeal_btn_rules_agree') {
    const permanentBlock = db.getPermanentAppealBlockByUser(interaction.user.id);
    if (permanentBlock) {
      return interaction.reply({
        content: '⛔ You are permanently blocked from submitting future appeals because staff verified that your actual Gear Score did not match your submitted value.',
        ephemeral: true,
      });
    }

    const existingActive = db.getActiveAppealByUser(interaction.user.id);
    if (existingActive && !isAppealOwner(interaction)) {
      return interaction.reply({
        content: `⚠️ You already have an active appeal under review (**${existingActive.appeal_code}**).`,
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
    const gearScoreInput = interaction.fields.getTextInputValue('appeal_input_gear_score').trim();
    const alasan = (interaction.fields.getTextInputValue('appeal_input_alasan') || '').trim().slice(0, 500);
    const infoTambahan = (interaction.fields.getTextInputValue('appeal_input_info_tambahan') || '').trim().slice(0, 300) || '-';
    const robloxExperience = interaction.fields.getTextInputValue('appeal_input_roblox_experience').trim().slice(0, 200);

    if (!/^\d{1,9}$/.test(gearScoreInput) || !Number.isSafeInteger(Number(gearScoreInput))) {
      return interaction.editReply({
        content: '❌ Gear Score must be a whole number between 0 and 999,999,999.',
      });
    }
    const gearScore = Number(gearScoreInput);

    const permanentBlock = db.getPermanentAppealBlockByUser(interaction.user.id);
    if (permanentBlock) {
      return interaction.editReply({
        content: '⛔ You are permanently blocked from submitting future appeals because staff verified that your actual Gear Score did not match your submitted value.',
      });
    }

    // Prevent multiple active appeals
    const isOwner = isAppealOwner(interaction);
    const existingActive = db.getActiveAppealByUser(interaction.user.id);
    if (existingActive && !isOwner) {
      return interaction.editReply({
        content: `⚠️ You already have an active appeal under review (**${existingActive.appeal_code}**). Please wait for the staff decision before submitting another.`,
      });
    }

    // Two-day cooldown after the latest final decision; Owners bypass this for testing.
    const COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;
    const latestAppeal = db.getLatestAppealByUser(interaction.user.id);
    if (!isOwner && latestAppeal && latestAppeal.status !== 'PENDING_REVIEW') {
      const cooldownStartsAt = latestAppeal.reviewed_at || latestAppeal.created_at;
      const elapsed = Date.now() - cooldownStartsAt;
      if (elapsed < COOLDOWN_MS) {
        const cooldownEndsAt = Math.floor((cooldownStartsAt + COOLDOWN_MS) / 1000);
        return interaction.editReply({
          content: `⏳ You are on a **2-day cooldown** after your last appeal.\nYou can submit again <t:${cooldownEndsAt}:R> (<t:${cooldownEndsAt}:f>).`,
        });
      }
    }

    // Validasi konfigurasi channel
    const targetChannelId = config.guildAppealChannelId || config.staffChannelId;
    if (!targetChannelId || targetChannelId.trim() === '') {
      logger.error('GUILD_APPEAL_CHANNEL_ID belum dikonfigurasi pada file .env');
      return interaction.editReply({
        content: '⚠️ The appeal channel has not been configured. Please contact the guild staff.',
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
        content: '❌ The appeal channel could not be found or the bot cannot access it.',
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
        gearScore,
        reason: alasan,
        extraInfo: infoTambahan,
        robloxExperience,
        rulesAgreed: 1,
        memberRating,
      });
    } catch (dbError) {
      logger.error('Gagal menyimpan appeal ke database SQLite:', dbError);
      return interaction.editReply({
        content: '❌ Your application could not be saved. Please try again later.',
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
        content: '❌ The form contains invalid data. Please check it and submit again.',
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
        content: '⚠️ Your application was not sent to the review channel. Please try again or contact the staff.',
      });
    }

    try {
      db.updateAppealMessage(appeal.id, staffChannel.id, staffMessage.id);
    } catch (trackingError) {
      logger.error(`Pesan appeal terkirim tetapi gagal menyimpan ID pesannya (${appeal.appeal_code}):`, trackingError);
      return interaction.editReply({
        content: '⚠️ Your application was sent, but its delivery status could not be updated. Please contact the staff.',
      });
    }

    logger.info(
      `Appeal ${appeal.appeal_code} (Roblox: ${robloxUsername}) sent to GUILD_APPEAL_CHANNEL_ID (Msg ID: ${staffMessage.id})`
    );

    await sendAppealLog(interaction.client, {
      title: 'New Appeal Submitted',
      color: 0x3498db,
      fields: [
        { name: '📋 Appeal ID', value: appeal.appeal_code, inline: true },
        { name: '👤 Applicant', value: `<@${appeal.user_id}> (${appeal.user_tag})`, inline: true },
        { name: '🎮 Roblox Username', value: robloxUsername, inline: true },
        { name: '⚔️ Gear Score', value: `${gearScore.toLocaleString('en-US')} GS`, inline: true },
        { name: '🕹️ The Forge Play Schedule', value: robloxExperience, inline: true },
        { name: '📝 Reason for Joining', value: alasan.slice(0, 500), inline: false },
      ],
    });

    const gearScoreDmSent = await sendGearScoreScreenshotDm(interaction.client, interaction.user.id, appeal);

    const userConfirmEmbed = new EmbedBuilder()
      .setTitle('✅ Appeal Submitted Successfully')
      .setDescription(
        `Thank you, **${interaction.user.username}**. Your application has been received!\n\n` +
        `• **Appeal ID:** ${appeal.appeal_code}\n` +
        `• **Roblox Username:** ${robloxUsername}\n` +
        `• **Gear Score:** ${gearScore.toLocaleString('en-US')} GS\n\n` +
        `• **The Forge Play Schedule:** ${robloxExperience}\n\n` +
        'Your appeal has been sent to the community review and voting channel.\n\n' +
        (gearScoreDmSent
          ? '📸 **Gear Score screenshot:** Reply directly to the bot DM with a clear screenshot of your current Gear Score for staff verification.\n\n'
          : '📸 **Gear Score screenshot:** Please contact staff and send a clear image of your Gear Score because the bot could not send the DM request.\n\n') +
        '⛔ **Important:** Staff will manually verify your actual Gear Score. If it does not match the value in your application and your appeal is denied for this mismatch, you will be permanently blocked from submitting future appeals.\n\n' +
        '📌 You cannot submit another appeal while this one is under review.'
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
  } else if (customId.startsWith('appeal_btn_reject_mismatch_')) {
    action = 'REJECT_MISMATCH';
    appealId = Number(customId.replace('appeal_btn_reject_mismatch_', ''));
  } else if (customId.startsWith('appeal_btn_reject_other_')) {
    action = 'REJECT_OTHER';
    appealId = Number(customId.replace('appeal_btn_reject_other_', ''));
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

  if (!['MANAGE', 'UNDER_REVIEW', 'APPROVE', 'REJECT', 'REJECT_MISMATCH', 'REJECT_OTHER', 'WARN'].includes(action)) {
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

  // 3. Aksi REJECT: Staff memilih apakah penolakan berdasarkan mismatch GS yang sudah diverifikasi
  if (action === 'REJECT') {
    const verificationRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal_btn_reject_mismatch_${appealId}`)
        .setLabel('Verified GS mismatch — permanent block')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`appeal_btn_reject_other_${appealId}`)
        .setLabel('Other denial — no permanent block')
        .setStyle(ButtonStyle.Secondary),
    );
    const verificationPrompt = {
      content:
        `Compare the submitted Gear Score (**${appeal.gear_score ?? 'Not provided'} GS**) with the member's actual in-game GS. ` +
        'Select a mismatch only after manually verifying it.',
      components: [verificationRow],
    };

    return isStatusMenu
      ? interaction.update(verificationPrompt)
      : interaction.reply({ ...verificationPrompt, ephemeral: true });
  }

  // 4. Open the denial-reason modal after the staff selects a verified outcome.
  if (action === 'REJECT_MISMATCH' || action === 'REJECT_OTHER') {
    const outcome = action === 'REJECT_MISMATCH' ? 'mismatch' : 'other';
    const rejectModal = new ModalBuilder()
      .setCustomId(`appeal_modal_reject_${appealId}_${outcome}`)
      .setTitle(`Deny Appeal ${appeal.appeal_code}`);

    const reasonInput = new TextInputBuilder()
      .setCustomId('appeal_input_reject_reason')
      .setLabel('Reason for Denial')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Explain the denial. Permanent block applies only to a manually verified GS mismatch.')
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
      .setTitle(`Send Warning — ${appeal.appeal_code}`);

    const warnInput = new TextInputBuilder()
      .setCustomId('appeal_input_warn_message')
      .setLabel('Warning Message')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Write the official warning that will be sent via DM...')
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

  const modalMatch = customId.match(/^appeal_modal_reject_(\d+)(?:_(mismatch|other))?$/);
  const appealId = Number(modalMatch?.[1]);
  const rejectionReason = interaction.fields.getTextInputValue('appeal_input_reject_reason');

  if (!appealId || isNaN(appealId)) {
    return interaction.editReply({ content: '❌ ID permohonan tidak valid.' });
  }

  const appeal = db.getAppealById(appealId);
  if (!appeal) {
    return interaction.editReply({ content: '❌ Appeal data could not be found.' });
  }

  const permanentlyBlock = modalMatch?.[2] === 'mismatch';
  const reviewResult = db.reviewAppeal(appealId, 'REJECTED', user.id, rejectionReason, permanentlyBlock);
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
    title: '❌ Appeal Denied',
    color: 0xe74c3c,
    fields: [
      { name: '📋 Appeal ID', value: updatedAppeal.appeal_code, inline: true },
      { name: '🎮 Roblox', value: updatedAppeal.roblox_username || updatedAppeal.ign || '-', inline: true },
      { name: '⚔️ Gear Score', value: `${updatedAppeal.gear_score ?? 'Not provided'} GS`, inline: true },
      { name: '👤 Applicant', value: `<@${updatedAppeal.user_id}>`, inline: true },
      { name: '🛡️ Denied By', value: `<@${user.id}> (${user.tag})`, inline: false },
      { name: '📝 Reason for Denial', value: rejectionReason, inline: false },
      { name: '⛔ Future Appeals', value: updatedAppeal.permanent_block ? 'Permanently blocked' : 'Not blocked', inline: true },
      { name: '📩 DM Status', value: dmSentReject ? '✅ Sent' : '❌ Failed (DMs closed)', inline: false },
    ],
  });

  return interaction.editReply({
    content: updatedAppeal.permanent_block
      ? `❌ Appeal **${updatedAppeal.appeal_code}** denied. Staff verified that the actual GS did not match the submitted value, so this user is permanently blocked from submitting future appeals.`
      : `❌ Appeal **${updatedAppeal.appeal_code}** (${updatedAppeal.roblox_username || updatedAppeal.ign}) has been denied.`,
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
  isOwnerOrAdmin,
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
  sendGearScoreScreenshotDm,
  sendWarningDm,
};
