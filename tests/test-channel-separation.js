const { config } = require('../src/config');
const setupAppeal = require('../src/commands/setup-appeal');
const appealInteractions = require('../src/utils/appealInteractions');
const db = require('../src/database/db');

async function testChannelSeparation() {
  console.log('=== TEST PEMISAHAN CHANNEL APPEAL & STAFF ===\n');

  console.log('1. Memeriksa Konfigurasi Channel ID di .env:');
  console.log('   APPEAL_CHANNEL_ID:', config.appealChannelId);
  console.log('   STAFF_CHANNEL_ID :', config.staffChannelId);

  if (!config.appealChannelId || !config.staffChannelId) {
    throw new Error('APPEAL_CHANNEL_ID atau STAFF_CHANNEL_ID belum terisi di .env!');
  }

  if (config.appealChannelId === config.staffChannelId) {
    throw new Error('APPEAL_CHANNEL_ID dan STAFF_CHANNEL_ID tidak boleh sama!');
  }
  console.log('   -> Kedua channel terpisah secara definitif (OK)\n');

  console.log('2. Menguji /setup-appeal Mengirim Panel ke APPEAL_CHANNEL_ID:');
  let panelSentToChannel = null;
  let panelEmbedTitle = null;
  let panelHasReviewButtons = false;

  const mockTargetChannel = {
    id: config.appealChannelId,
    name: 'appeal-join-guild',
    isTextBased: () => true,
    permissionsFor: () => ({
      has: () => true,
    }),
    send: async (payload) => {
      panelSentToChannel = config.appealChannelId;
      panelEmbedTitle = payload.embeds[0].data.title;
      const buttons = payload.components[0].components.map((c) => c.data.custom_id);
      panelHasReviewButtons = buttons.some((b) => b.includes('approve') || b.includes('reject'));
      console.log('   Embed panel terkirim ke channel ID:', panelSentToChannel);
      console.log('   Judul Embed:', panelEmbedTitle);
      console.log('   Tombol Panel:', buttons);
      return { id: 'msg-panel-1' };
    },
    toString: () => `<#${config.appealChannelId}>`,
  };

  const mockSetupInteraction = {
    inGuild: () => true,
    guild: {
      ownerId: 'owner-user-id',
      members: { me: {} },
      channels: {
        fetch: async (id) => (id === config.appealChannelId ? mockTargetChannel : null),
      },
    },
    user: { id: 'owner-user-id' },
    member: { roles: { cache: new Map() } },
    options: {
      getChannel: () => null, // Default channel (APPEAL_CHANNEL_ID)
    },
    reply: async (res) => {
      console.log('   Balasan Command Setup:', res.content);
    },
  };

  await setupAppeal.execute(mockSetupInteraction);

  if (panelSentToChannel !== config.appealChannelId) {
    throw new Error('Panel TIDAK terkirim ke APPEAL_CHANNEL_ID!');
  }
  if (panelHasReviewButtons) {
    throw new Error('Panel di APPEAL_CHANNEL_ID tidak boleh berisi tombol review staff!');
  }
  console.log('   -> Panel berhasil dikirim ke APPEAL_CHANNEL_ID tanpa tombol review (OK)\n');

  console.log('3. Menguji Submission Pemain Terkirim ke STAFF_CHANNEL_ID (Bukan APPEAL_CHANNEL_ID):');
  let submissionSentToChannel = null;
  let submissionEmbedTitle = null;
  let submissionHasManageButton = false;

  const mockStaffChannel = {
    id: config.staffChannelId,
    name: 'member-appeal',
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => {
      submissionSentToChannel = config.staffChannelId;
      submissionEmbedTitle = payload.embeds[0].data.title;
      const buttons = payload.components.flatMap((row) => row.components.map((c) => c.data.custom_id));
      submissionHasManageButton = buttons.some((b) => b.includes('manage'));
      console.log('   Submission terkirim ke channel ID:', submissionSentToChannel);
      console.log('   Judul Embed Submission:', submissionEmbedTitle);
      console.log('   Tombol Manage Staff:', buttons);
      return { id: 'msg-staff-1' };
    },
  };

  const mockModalInteraction = {
    customId: 'appeal_modal_form',
    user: { id: 'player-test-channel', username: 'TestPlayer', tag: 'TestPlayer#9999' },
    client: {
      channels: {
        fetch: async (id) => {
          if (id === config.staffChannelId) return mockStaffChannel;
          if (id === config.appealChannelId) return mockTargetChannel;
          return null;
        },
      },
    },
    fields: {
      getTextInputValue: (id) => {
        const val = {
          appeal_input_roblox_username: 'TestWarrior',
          appeal_input_gear_score: '6500',
          appeal_input_alasan: 'Testing the channel separation flow',
          appeal_input_info_tambahan: 'Level 99, active player',
          appeal_input_roblox_experience: '12 hours daily, every other day',
        };
        return val[id];
      },
    },
    deferReply: async () => {},
    editReply: async (res) => {
      console.log('   Applicant confirmation:', res.embeds[0].data.title);
    },
  };

  await appealInteractions.handleAppealModal(mockModalInteraction);

  if (submissionSentToChannel !== config.staffChannelId) {
    throw new Error('Submission TIDAK terkirim ke STAFF_CHANNEL_ID!');
  }
  if (submissionSentToChannel === config.appealChannelId) {
    throw new Error('FATAL: Submission terkirim ke APPEAL_CHANNEL_ID!');
  }
  if (!submissionHasManageButton) {
    throw new Error('Submission in STAFF_CHANNEL_ID must have the Manage button!');
  }
  console.log('   -> Submission sent to STAFF_CHANNEL_ID with Manage button (OK)\n');

  // Bersihkan data uji di database
  db.db.exec("DELETE FROM appeals WHERE user_id = 'player-test-channel';");
  console.log('=== SEMUA PENGUJIAN PEMISAHAN CHANNEL BERHASIL 100%! ===');
}

testChannelSeparation().catch((err) => {
  console.error('Pengujian Gagal:', err);
  process.exit(1);
});
