const { EmbedBuilder } = require('discord.js');
const { config } = require('../config');
const logger = require('./logger');

// Definisi 4 Jadwal Boss Raid setiap hari (WIB / UTC+7)
const RAIDS = [
  { id: 'morning', name: 'Morning Raid', icon: '🌅', hour: 6, minute: 30 },
  { id: 'afternoon', name: 'Afternoon Raid', icon: '☀️', hour: 12, minute: 30 },
  { id: 'evening', name: 'Evening Raid', icon: '🌆', hour: 18, minute: 30 },
  { id: 'night', name: 'Night Raid', icon: '🌙', hour: 19, minute: 30 },
];

// Menit pengingat sebelum raid
const REMINDER_MINUTES = [10, 5, 1, 0];

// Menyimpan ID alert yang sudah terkirim agar tidak duplikat
const sentAlerts = new Set();

/**
 * Menghitung waktu Epoch (ms) untuk raid tertentu pada tanggal WIB tertentu
 */
function getRaidTargetMs(year, month, day, hour, minute) {
  // WIB adalah UTC+7, jadi UTC hour = hour - 7
  return Date.UTC(year, month - 1, day, hour - 7, minute, 0, 0);
}

/**
 * Mendapatkan tanggal WIB saat ini (year, month, day)
 */
function getWibDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = formatter.format(date).split('-').map(Number);
  return { year, month, day };
}

/**
 * Membuat Discord Embed notifikasi Raid
 */
function buildRaidNotificationEmbed({ raid, targetUnix, minutesBefore, isTest = false }) {
  let title = '';
  let color = 0x3498db;
  let statusDesc = '';

  if (minutesBefore === 0) {
    title = `⚔️ [NOW STARTING] ${raid.icon} ${raid.name.toUpperCase()} IS NOW OPEN!`;
    color = 0x2ecc71; // Green
    statusDesc = 'The Boss Raid gates have opened! Rally with your guild members in-game right now!';
  } else if (minutesBefore === 1) {
    title = `🚨 [1 MINUTE LEFT] ${raid.icon} ${raid.name.toUpperCase()} STARTS SOON!`;
    color = 0xe74c3c; // Red (Urgent)
    statusDesc = 'The raid begins in 1 minute! Make sure you are in position at the raid arena!';
  } else if (minutesBefore === 5) {
    title = `⚠️ [5 MINUTES LEFT] ${raid.icon} ${raid.name.toUpperCase()} STARTS SOON!`;
    color = 0xe67e22; // Dark Orange
    statusDesc = 'The raid starts in 5 minutes. Log into the game now and equip your best gear!';
  } else {
    title = `⏰ [10 MINUTES LEFT] ${raid.icon} ${raid.name.toUpperCase()} IS STARTING SOON!`;
    color = 0xf39c12; // Gold / Yellow
    statusDesc = 'Guild Boss Raid reminder! Prepare your character, buff items, and team coordination.';
  }

  const embed = new EmbedBuilder()
    .setTitle(isTest ? `🧪 [TEST] ${title}` : title)
    .setColor(color)
    .setDescription(
      `### ${raid.icon} **${raid.name}**\n\n` +
      `${statusDesc}\n\n` +
      `📌 **Start Time:** <t:${targetUnix}:t> (<t:${targetUnix}:R>)\n` +
      `🌐 *The time above automatically converts to your local device timezone.*`
    )
    .addFields(
      {
        name: '🛡️ Guild Raid Checklist',
        value: '• Use weaker weapons so everyone can get rewards\n• Join the game server on time\n• Follow instructions from the Guild Officer / Raid Leader',
        inline: false,
      }
    )
    .setFooter({
      text: isTest
        ? 'Guild Raid Notification • Test Mode'
        : 'Guild Raid Notification System • Auto Local Time',
    })
    .setTimestamp();

  return embed;
}

/**
 * Mengirim notifikasi raid ke channel yang ditentukan
 */
async function sendRaidNotification(client, { raid, targetUnix, minutesBefore, isTest = false }) {
  const channelId = config.raidReminderChannelId;
  if (!channelId || channelId.trim() === '') {
    logger.warn('RAID_REMINDER_CHANNEL_ID belum dikonfigurasi di .env');
    return false;
  }

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      logger.error(`Channel reminder raid (${channelId}) tidak ditemukan atau bukan text channel.`);
      return false;
    }

    const roleMention = config.raidReminderRoleId ? `<@&${config.raidReminderRoleId}>` : '@everyone';
    const embed = buildRaidNotificationEmbed({ raid, targetUnix, minutesBefore, isTest });

    await channel.send({
      content: roleMention,
      embeds: [embed],
    });

    logger.info(
      `[RAID NOTIF] ${isTest ? '[TEST] ' : ''}Notifikasi ${raid.name} (${minutesBefore}m sebelum) berhasil dikirim ke #${channel.name}`
    );
    return true;
  } catch (error) {
    logger.error('Gagal mengirim pesan pengingat raid:', error);
    return false;
  }
}

/**
 * Pengecekan berkala (dijalankan tiap 20 detik)
 */
async function checkUpcomingRaids(client) {
  const now = Date.now();
  const { year, month, day } = getWibDateParts(new Date(now));

  // Periksa jadwal untuk hari ini dan besok (antisipasi rollover hari)
  const daysToCheck = [
    { year, month, day },
    // hari berikutnya
    getWibDateParts(new Date(now + 86400000)),
  ];

  for (const dayPart of daysToCheck) {
    for (const raid of RAIDS) {
      const targetMs = getRaidTargetMs(dayPart.year, dayPart.month, dayPart.day, raid.hour, raid.minute);
      const targetUnix = Math.floor(targetMs / 1000);

      for (const mins of REMINDER_MINUTES) {
        const triggerMs = targetMs - mins * 60 * 1000;
        const diffMs = now - triggerMs;

        // Window toleransi pengecekan: 0 sampai 45 detik setelah waktu pemicu
        if (diffMs >= 0 && diffMs < 45000) {
          const alertKey = `${dayPart.year}-${dayPart.month}-${dayPart.day}_${raid.id}_${mins}m`;

          if (!sentAlerts.has(alertKey)) {
            sentAlerts.add(alertKey);
            await sendRaidNotification(client, {
              raid,
              targetUnix,
              minutesBefore: mins,
              isTest: false,
            });
          }
        }
      }
    }
  }

  // Bersihkan cache lama jika sudah lebih dari 200 item
  if (sentAlerts.size > 200) {
    sentAlerts.clear();
  }
}

/**
 * Memulai Background Scheduler
 */
let schedulerInterval = null;

function startRaidScheduler(client) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  logger.info('[RAID SCHEDULER] Background scheduler raid reminder diaktifkan (interval 20 detik).');

  // Jalankan segera sekali, lalu ulangi setiap 20 detik
  checkUpcomingRaids(client).catch((err) => logger.error('Error saat initial raid check:', err));
  schedulerInterval = setInterval(() => {
    checkUpcomingRaids(client).catch((err) => logger.error('Error saat running raid check:', err));
  }, 20000);
}

module.exports = {
  RAIDS,
  REMINDER_MINUTES,
  buildRaidNotificationEmbed,
  sendRaidNotification,
  checkUpcomingRaids,
  startRaidScheduler,
};
