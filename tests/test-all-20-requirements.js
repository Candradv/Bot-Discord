const path = require('path');
const db = require('../src/database/db');
const appealInteractions = require('../src/utils/appealInteractions');
const setupAppeal = require('../src/commands/setup-appeal');
const guildWarning = require('../src/commands/guild-warning');
const appealBlock = require('../src/commands/appeal-block');
const appealUnblock = require('../src/commands/appeal-unblock');
const { config } = require('../src/config');
const { DatabaseSync } = require('node:sqlite');

async function run20MandatoryTests() {
  console.log('====================================================');
  console.log('=== RUNNING 20 MANDATORY TESTS FOR JOIN APPEAL BOT ===');
  console.log('====================================================\n');

  config.ownerRoleId = 'owner-role-123';
  config.staffRoleId = 'staff-role-456';
  config.appealChannelId = 'chan-appeal-pub-1';
  config.staffChannelId = 'chan-staff-review-2';
  config.joinAppealChannelId = config.appealChannelId;
  config.guildAppealChannelId = config.staffChannelId;

  const mockStaffMember = {
    id: 'staff-user-1',
    roles: { cache: new Map([['staff-role-456', { id: 'staff-role-456' }]]) },
    permissions: { has: () => false },
  };

  const mockNonStaffMember = {
    id: 'regular-user-9',
    roles: { cache: new Map() },
    permissions: { has: () => false },
  };

  const mockClient = {
    users: {
      fetch: async (id) => {
        if (id === 'user-closed-dm') {
          return {
            id,
            username: 'ClosedDmUser',
            tag: 'ClosedDmUser#0001',
            send: async () => {
              const err = new Error('Cannot send messages to this user');
              err.code = 50007;
              throw err;
            },
          };
        }
        return {
          id,
          username: 'TestApplicant',
          tag: 'TestApplicant#0001',
          send: async () => ({ id: 'dm-sent-123' }),
        };
      },
    },
    channels: {
      fetch: async (id) => ({
        id,
        isTextBased: () => true,
        messages: {
          fetch: async (msgId) => ({
            id: msgId,
            edit: async (data) => data,
          }),
        },
      }),
    },
  };

  // ----------------------------------------------------
  // TEST 1: Panel muncul di APPEAL_CHANNEL_ID
  // ----------------------------------------------------
  console.log('TEST 1: Panel muncul di APPEAL_CHANNEL_ID');
  let panelTargetId = null;
  let panelEmbedTitle = null;
  await setupAppeal.execute({
    inGuild: () => true,
    guild: {
      ownerId: 'owner-user-id',
      members: { me: {} },
      channels: {
        fetch: async (id) => ({
          id,
          isTextBased: () => true,
          permissionsFor: () => ({ has: () => true }),
          send: async (p) => {
            panelTargetId = id;
            panelEmbedTitle = p.embeds[0].data.title;
          },
          toString: () => `<#${id}>`,
        }),
      },
    },
    user: { id: 'owner-user-id' },
    member: { roles: { cache: new Map([['owner-role-123', { id: 'owner-role-123' }]]) } },
    options: { getChannel: () => null },
    reply: async () => {},
  });
  console.log('   Panel target channel:', panelTargetId, '| Title:', panelEmbedTitle);
  if (panelTargetId !== config.appealChannelId) throw new Error('Test 1 Failed');

  // ----------------------------------------------------
  // TEST 3: Rules Agreement menampilkan enam aturan
  // ----------------------------------------------------
  console.log('\nTEST 3: Rules Agreement menampilkan 6 aturan');
  let rulesDesc = '';
  await appealInteractions.handleAppealButton({
    customId: 'appeal_btn_start',
    user: { id: 'user-new-applicant' },
    reply: async (p) => {
      rulesDesc = p.embeds[0].data.description;
    },
  });
  const rule1 = rulesDesc.includes('1. Weekly Guild XP');
  const rule2 = rulesDesc.includes('2. Daily Donation');
  const rule3 = rulesDesc.includes('3. Guild Raid');
  const rule4 = rulesDesc.includes('4. Boss Raid Schedule');
  const raidTimesUseWib = rulesDesc.includes('Western Indonesia Time / WIB');
  const rule5 = rulesDesc.includes('5. Minimum GS Requirement');
  const rule6 = rulesDesc.includes('6. Activity Requirement');
  console.log('   Contains 6 rules and WIB timezone:', rule1 && rule2 && rule3 && rule4 && raidTimesUseWib && rule5 && rule6);
  if (!(rule1 && rule2 && rule3 && rule4 && raidTimesUseWib && rule5 && rule6)) throw new Error('Test 3 Failed');

  let formModal = null;
  await appealInteractions.handleAppealButton({
    customId: 'appeal_btn_rules_agree',
    user: { id: 'user-modal-test' },
    showModal: async (modal) => {
      formModal = modal.toJSON();
    },
  });
  const formInputIds = formModal.components.map((row) => row.components[0].custom_id);
  if (
    !formInputIds.includes('appeal_input_gear_score') ||
    !formInputIds.includes('appeal_input_roblox_experience') ||
    formInputIds.some((id) => id.includes('screenshot'))
  ) {
    throw new Error('Appeal form is missing Gear Score or Roblox / The Forge playtime');
  }

  // ----------------------------------------------------
  // TEST 4, 5, 6, 7: Roblox Username, Gear Score, STAFF_CHANNEL_ID, Auto-numbering
  // ----------------------------------------------------
  console.log('\nTEST 4, 5, 6, 7: Form Roblox Username, Gear Score, STAFF_CHANNEL_ID & Auto-numbering');
  let sentToStaffChannelId = null;
  let staffEmbedData = null;
  let staffComponents = null;

  const mockStaffChan = {
    id: config.staffChannelId,
    isTextBased: () => true,
    send: async (p) => {
      sentToStaffChannelId = config.staffChannelId;
      staffEmbedData = p.embeds[0];
      staffComponents = p.components;
      return { id: 'msg-staff-test-01' };
    },
  };

  await appealInteractions.handleAppealModal({
    customId: 'appeal_modal_form',
    user: { id: 'user-applicant-1', username: 'Applicant1', tag: 'Applicant1#0001' },
    client: {
      channels: {
        fetch: async (id) => (id === config.staffChannelId ? mockStaffChan : null),
      },
    },
    fields: {
      getTextInputValue: (field) => {
        if (field === 'appeal_input_roblox_username') return 'RobloxMaster99';
        if (field === 'appeal_input_gear_score') return '6500';
        if (field === 'appeal_input_alasan') return 'I want to contribute to the guild.';
        if (field === 'appeal_input_roblox_experience') return '12 hours daily, every other day';
        return '';
      },
    },
    deferReply: async () => {},
    editReply: async () => {},
  });

  console.log('   Sent to STAFF_CHANNEL_ID:', sentToStaffChannelId === config.staffChannelId);
  console.log('   Roblox Username in Embed:', staffEmbedData.data.fields.find((f) => f.name.includes('Roblox'))?.value);
  console.log('   Gear Score in Embed:', staffEmbedData.data.fields.find((f) => f.name.includes('Gear Score'))?.value);
  console.log('   Appeal Auto-Number in Embed:', staffEmbedData.data.title);
  const gearScoreField = staffEmbedData.data.fields.find((f) => f.name.includes('Gear Score'));
  const playtimeField = staffEmbedData.data.fields.find((f) => f.name.includes('Play Schedule'));
  if (sentToStaffChannelId !== config.staffChannelId || !gearScoreField?.value.includes('6,500 GS')) {
    throw new Error('Gear Score was not included in the staff appeal embed');
  }
  if (playtimeField?.value !== '12 hours daily, every other day') {
    throw new Error('The Forge play schedule was not included in the staff appeal embed');
  }
  if (staffComponents[1].components.length !== 1 || staffComponents[1].components[0].data.label !== 'Manage') {
    throw new Error('Appeal does not have a single Manage button');
  }

  // ----------------------------------------------------
  // TEST 2: Submission tidak masuk ke APPEAL_CHANNEL_ID
  // ----------------------------------------------------
  console.log('\nTEST 2: Submission tidak masuk ke APPEAL_CHANNEL_ID');
  console.log('   Submission channel !== APPEAL_CHANNEL_ID:', sentToStaffChannelId !== config.appealChannelId);
  if (sentToStaffChannelId === config.appealChannelId) throw new Error('Test 2 Failed');

  const app1 = db.getActiveAppealByUser('user-applicant-1');
  if (!app1 || !/^Guild Appeal --\d+$/.test(app1.appeal_code)) throw new Error('Test 4/5/6/7 Failed');

  let statusMenu = null;
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_manage_${app1.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    reply: async (payload) => {
      statusMenu = payload.components[0].components[0];
    },
  });
  if (!statusMenu || statusMenu.toJSON().options.length !== 3) throw new Error('Manage status menu is incomplete');
  let underReviewUpdate = null;
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_select_status_${app1.id}`,
    values: ['UNDER_REVIEW'],
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    update: async (payload) => {
      underReviewUpdate = payload;
    },
  });
  if (!underReviewUpdate?.content.includes('Under Review')) {
    throw new Error('Manage menu could not keep an appeal under review');
  }
  let denialVerificationPrompt = null;
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_select_status_${app1.id}`,
    values: ['REJECT'],
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    update: async (payload) => {
      denialVerificationPrompt = payload;
    },
  });
  const denialButtons = denialVerificationPrompt.components.flatMap((row) => row.components);
  if (
    !denialVerificationPrompt.content.includes('manually verifying') ||
    !denialButtons.some((button) => button.data.custom_id === `appeal_btn_reject_mismatch_${app1.id}`) ||
    !denialButtons.some((button) => button.data.custom_id === `appeal_btn_reject_other_${app1.id}`)
  ) {
    throw new Error('Staff denial flow does not require an explicit GS verification outcome');
  }
  let mismatchModalId = '';
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_reject_mismatch_${app1.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    showModal: async (modal) => {
      mismatchModalId = modal.toJSON().custom_id;
    },
  });
  if (mismatchModalId !== `appeal_modal_reject_${app1.id}_mismatch`) {
    throw new Error('Verified GS mismatch selection did not reach the permanent-block denial flow');
  }

  let warningDelivered = false;
  const warningClient = {
    users: {
      fetch: async () => ({
        send: async (payload) => {
          warningDelivered =
            payload.embeds[0].data.description.includes('Weekly Guild XP') &&
            payload.embeds[0].data.description.toLowerCase().includes('kick tidak dilakukan otomatis');
        },
      }),
    },
    channels: { fetch: async () => null },
  };
  let warningReply = '';
  await guildWarning.execute({
    inGuild: () => true,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    options: {
      getUser: () => ({ id: 'member-to-warn', tag: 'Member#0001', bot: false }),
      getMember: () => ({ id: 'member-to-warn' }),
      getString: (name) => (name === 'requirement' ? 'Weekly Guild XP' : 'Progres mulai mendekati batas.'),
      getBoolean: () => null,
    },
    deferReply: async () => {},
    editReply: async (payload) => {
      warningReply = payload.content;
    },
  }, warningClient);
  if (!warningDelivered || !warningReply.includes('berhasil dikirim')) {
    throw new Error('Guild warning command failed');
  }

  let noDmWasSent = true;
  let noDmReply = '';
  await guildWarning.execute({
    inGuild: () => true,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    options: {
      getUser: () => ({ id: 'member-to-warn', tag: 'Member#0001', bot: false }),
      getMember: () => ({ id: 'member-to-warn' }),
      getString: (name) => (name === 'requirement' ? 'Activity Requirement' : null),
      getBoolean: () => false,
    },
    deferReply: async () => {},
    editReply: async (payload) => {
      noDmReply = payload.content;
    },
  }, {
    users: {
      fetch: async () => {
        noDmWasSent = false;
        throw new Error('DM should not be attempted when disabled');
      },
    },
    channels: { fetch: async () => null },
  });
  if (!noDmWasSent || !noDmReply.includes('DM tidak dikirim')) {
    throw new Error('Guild warning DM opt-out failed');
  }

  let nonMemberReply = '';
  await guildWarning.execute({
    inGuild: () => true,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    options: {
      getUser: () => ({ id: 'not-in-server', tag: 'Guest#0001', bot: false }),
      getMember: () => null,
      getString: () => null,
      getBoolean: () => true,
    },
    reply: async (payload) => {
      nonMemberReply = payload.content;
    },
  }, {});
  if (!nonMemberReply.includes('masih berada di server')) {
    throw new Error('Guild warning accepted a user who is not a server member');
  }

  // ----------------------------------------------------
  // TEST 8: Anti-duplicate tetap berjalan
  // ----------------------------------------------------
  console.log('\nTEST 8: Anti-duplicate tetap berjalan');
  let dupBlocked = false;
  await appealInteractions.handleAppealButton({
    customId: 'appeal_btn_start',
    user: { id: 'user-applicant-1' },
    reply: async (res) => {
      dupBlocked = res.content.includes('already have an active appeal');
    },
  });
  console.log('   Duplicate applicant blocked:', dupBlocked);
  if (!dupBlocked) throw new Error('Test 8 Failed');

  // ----------------------------------------------------
  // TEST 9, 10, 11: Community Voting, Ganti Vote, Persistensi Restart
  // ----------------------------------------------------
  console.log('\nTEST 9 & 10: Community Member Voting & Ganti Vote');
  // Member 1 votes Support
  await appealInteractions.handleCommunityVoteButton({
    customId: `appeal_btn_vote_support_${app1.id}`,
    user: { id: 'voter-1', tag: 'Voter1#0001' },
    deferUpdate: async () => {},
    editReply: async () => {},
    followUp: async () => {},
  });
  // Member 2 votes Against
  await appealInteractions.handleCommunityVoteButton({
    customId: `appeal_btn_vote_against_${app1.id}`,
    user: { id: 'voter-2', tag: 'Voter2#0002' },
    deferUpdate: async () => {},
    editReply: async () => {},
    followUp: async () => {},
  });
  let vCounts = db.getVoteCounts(app1.id);
  console.log('   Initial votes (1 Support, 1 Against):', vCounts);

  // Member 2 ganti vote ke Support
  await appealInteractions.handleCommunityVoteButton({
    customId: `appeal_btn_vote_support_${app1.id}`,
    user: { id: 'voter-2', tag: 'Voter2#0002' },
    deferUpdate: async () => {},
    editReply: async () => {},
    followUp: async () => {},
  });
  vCounts = db.getVoteCounts(app1.id);
  console.log('   After Member 2 changed vote (2 Support, 0 Against):', vCounts);
  if (vCounts.support !== 2 || vCounts.against !== 0) throw new Error('Test 9/10 Failed');

  // ----------------------------------------------------
  // TEST 12: Non-staff tidak bisa Approve atau Reject
  // ----------------------------------------------------
  console.log('\nTEST 12: Non-staff tidak bisa Approve/Reject');
  let nonStaffBlocked = false;
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_approve_${app1.id}`,
    member: mockNonStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'regular-user-9', tag: 'Regular#0001' },
    reply: async (res) => {
      nonStaffBlocked = res.content.includes('tidak memiliki izin');
    },
  });
  console.log('   Non-staff review blocked:', nonStaffBlocked);
  if (!nonStaffBlocked) throw new Error('Test 12 Failed');

  // ----------------------------------------------------
  // TEST 15, 16, 17, 18: Staff Send Warning, Tidak ubah status, Multiple warnings, DM Error handling
  // ----------------------------------------------------
  console.log('\nTEST 15, 16, 17: Staff Send Warning & Status Remains Pending');
  let warn1Success = false;
  await appealInteractions.handleStaffWarnModal({
    customId: `appeal_modal_warn_${app1.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    client: mockClient,
    fields: { getTextInputValue: () => 'Please provide an update about your weekly activity.' },
    deferReply: async () => {},
    editReply: async (res) => {
      warn1Success = res.content.includes('berhasil dikirim');
    },
  });

  // Second warning on same appeal (Multiple warnings)
  await appealInteractions.handleStaffWarnModal({
    customId: `appeal_modal_warn_${app1.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    client: mockClient,
    fields: { getTextInputValue: () => 'Peringatan kedua mengenai kepatuhan jadwal raid.' },
    deferReply: async () => {},
    editReply: async () => {},
  });

  const app1AfterWarn = db.getAppealById(app1.id);
  const warnCount = db.getWarningCount(app1.id);
  console.log('   Warning 1 Sent:', warn1Success);
  console.log('   Total Warnings in DB:', warnCount);
  console.log('   Appeal status still Pending:', app1AfterWarn.status === 'PENDING_REVIEW');
  if (app1AfterWarn.status !== 'PENDING_REVIEW' || warnCount !== 2) throw new Error('Test 15/16/17 Failed');

  // TEST 18: DM gagal ditangani dengan aman
  console.log('\nTEST 18: DM gagal ditangani dengan aman (Closed DM User)');
  const appClosedDm = db.createAppeal({
    userId: 'user-closed-dm',
    userTag: 'Closed#0001',
    robloxUsername: 'PrivateDmPlayer',
    gearScore: 7000,
  });
  let closedDmNotice = false;
  await appealInteractions.handleStaffWarnModal({
    customId: `appeal_modal_warn_${appClosedDm.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    client: mockClient,
    fields: { getTextInputValue: () => 'Peringatan uji DM tertutup.' },
    deferReply: async () => {},
    editReply: async (res) => {
      closedDmNotice = res.content.includes('gagal dikirimkan ke pemohon via DM');
    },
  });
  console.log('   Safe handling on failed DM warning:', closedDmNotice);
  if (!closedDmNotice) throw new Error('Test 18 Failed');

  // ----------------------------------------------------
  // TEST 14: Staff berhasil Reject melalui modal
  // ----------------------------------------------------
  console.log('\nTEST 14: Staff berhasil Reject melalui modal');
  let rejectSuccess = false;
  await appealInteractions.handleStaffRejectModal({
    customId: `appeal_modal_reject_${appClosedDm.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    client: mockClient,
    fields: { getTextInputValue: () => 'The application does not meet the guild requirements.' },
    deferReply: async () => {},
    editReply: async (res) => {
      rejectSuccess = res.content.includes('has been denied');
    },
  });
  const closedDmAfterReject = db.getAppealById(appClosedDm.id);
  console.log('   Reject executed:', rejectSuccess);
  console.log('   Reject status in DB:', closedDmAfterReject.status);
  console.log('   Rejection reason in DB:', closedDmAfterReject.rejection_reason);
  if (closedDmAfterReject.status !== 'REJECTED' || !closedDmAfterReject.rejection_reason) {
    throw new Error('Test 14 Failed');
  }

  const cooldownAppeal = db.createAppeal({
    userId: 'user-cooldown-test',
    userTag: 'Cooldown#0001',
    robloxUsername: 'CooldownPlayer',
    gearScore: 7000,
  });
  db.reviewAppeal(cooldownAppeal.id, 'REJECTED', 'staff-user-1', 'Test denial');
  db.db.prepare('UPDATE appeals SET created_at = ?, reviewed_at = ? WHERE id = ?')
    .run(Date.now() - (5 * 24 * 60 * 60 * 1000), Date.now() - (1 * 24 * 60 * 60 * 1000), cooldownAppeal.id);
  let cooldownNotice = '';
  await appealInteractions.handleAppealModal({
    customId: 'appeal_modal_form',
    user: { id: 'user-cooldown-test', username: 'Cooldown', tag: 'Cooldown#0001' },
    guild: { ownerId: 'server-owner-id' },
    fields: {
      getTextInputValue: (field) => ({
        appeal_input_roblox_username: 'CooldownPlayer',
        appeal_input_gear_score: '7000',
        appeal_input_alasan: 'I would like to apply again.',
        appeal_input_roblox_experience: '12 hours daily, every other day',
      })[field] || '',
    },
    deferReply: async () => {},
    editReply: async (payload) => {
      cooldownNotice = payload.content;
    },
  });
  if (!cooldownNotice.includes('2-day cooldown')) {
    throw new Error('Cooldown was not measured from the denial decision time');
  }

  const expiredCooldownAppeal = db.createAppeal({
    userId: 'user-cooldown-expired',
    userTag: 'Ready#0001',
    robloxUsername: 'ReadyPlayer',
    gearScore: 7000,
  });
  db.reviewAppeal(expiredCooldownAppeal.id, 'REJECTED', 'staff-user-1', 'Test denial');
  db.db.prepare('UPDATE appeals SET created_at = ?, reviewed_at = ? WHERE id = ?')
    .run(Date.now() - (4 * 24 * 60 * 60 * 1000), Date.now() - (3 * 24 * 60 * 60 * 1000), expiredCooldownAppeal.id);
  let appealAfterCooldownSent = false;
  await appealInteractions.handleAppealModal({
    customId: 'appeal_modal_form',
    user: { id: 'user-cooldown-expired', username: 'Ready', tag: 'Ready#0001' },
    guild: { ownerId: 'server-owner-id' },
    client: {
      channels: {
        fetch: async (id) => (id === config.guildAppealChannelId ? mockStaffChan : null),
      },
    },
    fields: {
      getTextInputValue: (field) => ({
        appeal_input_roblox_username: 'ReadyPlayer',
        appeal_input_gear_score: '7000',
        appeal_input_alasan: 'I would like to apply again.',
        appeal_input_roblox_experience: '12 hours daily, every other day',
      })[field] || '',
    },
    deferReply: async () => {},
    editReply: async (payload) => {
      appealAfterCooldownSent = Boolean(payload.embeds);
    },
  });
  if (!appealAfterCooldownSent) {
    throw new Error('Applicant could not reapply after the two-day cooldown elapsed');
  }

  console.log('\nTEST: Owner dapat mengajukan ulang tanpa menunggu cooldown');
  let ownerResubmissionSent = false;
  const ownerMember = {
    id: 'owner-role-user',
    user: { id: '1573634423306592316' },
    roles: { cache: new Map([['owner-role-123', { id: 'owner-role-123' }]]) },
    permissions: { has: () => false },
  };
  db.createAppeal({
    userId: 'user-closed-dm',
    userTag: 'Closed#0001',
    robloxUsername: 'ExistingOwnerTest',
    gearScore: 7000,
  });
  let ownerRulesShown = false;
  await appealInteractions.handleAppealButton({
    customId: 'appeal_btn_start',
    user: { id: 'user-closed-dm' },
    member: ownerMember,
    guild: { ownerId: 'server-owner-id' },
    reply: async (payload) => {
      ownerRulesShown = Boolean(payload.embeds);
    },
  });
  if (!ownerRulesShown) throw new Error('Owner could not start a new appeal while another is pending');

  let ownerModalShown = false;
  await appealInteractions.handleAppealButton({
    customId: 'appeal_btn_rules_agree',
    user: { id: 'user-closed-dm' },
    member: ownerMember,
    guild: { ownerId: 'server-owner-id' },
    showModal: async () => {
      ownerModalShown = true;
    },
  });
  if (!ownerModalShown) throw new Error('Owner could not open a new appeal form while another is pending');

  await appealInteractions.handleAppealModal({
    customId: 'appeal_modal_form',
    user: { id: 'user-closed-dm', username: 'ClosedDmUser', tag: 'ClosedDmUser#0001' },
    member: ownerMember,
    guild: { ownerId: 'server-owner-id' },
    client: {
      channels: {
        fetch: async (id) => (id === config.guildAppealChannelId ? mockStaffChan : null),
      },
    },
    fields: {
      getTextInputValue: (field) => {
        if (field === 'appeal_input_roblox_username') return 'RetryApplicant';
        if (field === 'appeal_input_gear_score') return '7000';
        if (field === 'appeal_input_alasan') return 'Owner cooldown test';
        if (field === 'appeal_input_roblox_experience') return '4 hours daily, 5 days per week';
        return '';
      },
    },
    deferReply: async () => {},
    editReply: async (payload) => {
      ownerResubmissionSent = sentToStaffChannelId === config.guildAppealChannelId && Boolean(payload.embeds);
    },
  });
  if (!ownerResubmissionSent) throw new Error('Owner cooldown bypass failed');

  const lowGsAppeal = db.createAppeal({
    userId: 'user-low-gs',
    userTag: 'LowGs#0001',
    robloxUsername: 'LowGearPlayer',
    gearScore: 7000,
    reason: 'I want to join the guild.',
  });
  let mismatchRejected = false;
  await appealInteractions.handleStaffRejectModal({
    customId: `appeal_modal_reject_${lowGsAppeal.id}_mismatch`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    client: mockClient,
    fields: { getTextInputValue: () => 'Staff verified the actual GS does not match the submitted value.' },
    deferReply: async () => {},
    editReply: async (payload) => {
      mismatchRejected = payload.content.includes('actual GS did not match');
    },
  });
  if (!mismatchRejected || db.getAppealById(lowGsAppeal.id).permanent_block !== 1) {
    throw new Error('Manually verified Gear Score mismatch did not create a permanent appeal block');
  }

  let permanentBlockMessage = '';
  await appealInteractions.handleAppealButton({
    customId: 'appeal_btn_start',
    user: { id: 'user-low-gs' },
    guild: { ownerId: 'user-low-gs' },
    reply: async (payload) => {
      permanentBlockMessage = payload.content;
    },
  });
  if (!permanentBlockMessage.includes('permanently blocked')) {
    throw new Error('Permanently blocked user was allowed to start another appeal');
  }

  const accurateLowGsAppeal = db.createAppeal({
    userId: 'user-accurate-low-gs',
    userTag: 'Accurate#0001',
    robloxUsername: 'AccurateLowGs',
    gearScore: 5500,
    reason: 'My current Gear Score is below the guild requirement.',
  });
  await appealInteractions.handleStaffRejectModal({
    customId: `appeal_modal_reject_${accurateLowGsAppeal.id}_other`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    client: mockClient,
    fields: { getTextInputValue: () => 'The submitted score was verified as accurate but is below the requirement.' },
    deferReply: async () => {},
    editReply: async () => {},
  });
  if (db.getAppealById(accurateLowGsAppeal.id).permanent_block !== 0) {
    throw new Error('Accurate low Gear Score denial incorrectly created a permanent block');
  }

  const manualBlockOwner = {
    id: 'manual-block-owner',
    roles: { cache: new Map() },
    permissions: { has: () => false },
  };
  const manualBlockClient = {
    channels: {
      fetch: async (id) => ({
        id,
        isTextBased: () => true,
        send: async () => ({ id: 'audit-log-message' }),
      }),
    },
  };
  const manualBlockOptions = {
    getUser: () => ({ id: 'manual-block-target', tag: 'ManualBlock#0001', bot: false }),
    getMember: () => ({ id: 'manual-block-target' }),
    getString: () => 'Manual staff review requires an appeal block.',
  };
  let manualBlockReply = '';
  await appealBlock.execute({
    inGuild: () => true,
    member: manualBlockOwner,
    guild: { ownerId: manualBlockOwner.id },
    user: { id: manualBlockOwner.id, tag: 'ManualOwner#0001' },
    options: manualBlockOptions,
    deferReply: async () => {},
    editReply: async (payload) => {
      manualBlockReply = payload.content;
    },
  }, manualBlockClient);
  if (!db.getPermanentAppealBlockByUser('manual-block-target') || !manualBlockReply.includes('permanently blocked')) {
    throw new Error('/appeal-block did not create an active block');
  }

  let manualBlockPreventedAppeal = false;
  await appealInteractions.handleAppealButton({
    customId: 'appeal_btn_start',
    user: { id: 'manual-block-target' },
    guild: { ownerId: 'server-owner-id' },
    reply: async (payload) => {
      manualBlockPreventedAppeal = payload.content.includes('permanently blocked');
    },
  });
  if (!manualBlockPreventedAppeal) throw new Error('Manual appeal block did not prevent a new submission');

  let manualUnblockReply = '';
  await appealUnblock.execute({
    inGuild: () => true,
    member: manualBlockOwner,
    guild: { ownerId: manualBlockOwner.id },
    user: { id: manualBlockOwner.id, tag: 'ManualOwner#0001' },
    options: manualBlockOptions,
    deferReply: async () => {},
    editReply: async (payload) => {
      manualUnblockReply = payload.content;
    },
  }, manualBlockClient);
  if (db.getPermanentAppealBlockByUser('manual-block-target') || !manualUnblockReply.includes('Permanent appeal block removed')) {
    throw new Error('/appeal-unblock did not remove the active block');
  }

  // ----------------------------------------------------
  // TEST 13 & 19: Staff berhasil Approve & Semua tombol nonaktif setelah keputusan
  // ----------------------------------------------------
  console.log('\nTEST 13 & 19: Staff Approve & Semua Tombol Nonaktif');
  let allButtonsDisabled = false;
  let finalEmbed = null;
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_approve_${app1.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'owner-id' },
    user: { id: 'staff-user-1', tag: 'StaffOne#0001' },
    client: mockClient,
    deferUpdate: async () => {},
    editReply: async (payload) => {
      finalEmbed = payload.embeds[0];
      const row1Disabled = payload.components[0].components.every((b) => b.data.disabled === true);
      const row2Disabled = payload.components[1].components.every((b) => b.data.disabled === true);
      allButtonsDisabled = row1Disabled && row2Disabled;
    },
    followUp: async () => {},
  });
  const app1Approved = db.getAppealById(app1.id);
  console.log('   Approved status in DB:', app1Approved.status);
  console.log('   Reviewed by:', app1Approved.reviewed_by);
  console.log('   All action row buttons disabled:', allButtonsDisabled);
  console.log('   Final embed status:', finalEmbed.data.fields.find((f) => f.name.includes('Status'))?.value);
  if (app1Approved.status !== 'APPROVED' || !allButtonsDisabled) throw new Error('Test 13/19 Failed');

  // ----------------------------------------------------
  // TEST 11 & 20: Voting tersimpan & Database tetap utuh setelah restart
  // ----------------------------------------------------
  console.log('\nTEST 11 & 20: Voting tersimpan & Database utuh setelah restart');
  const freshDb = new DatabaseSync(path.join(__dirname, '..', 'data', 'appeals.db'));
  const checkApp1 = freshDb.prepare('SELECT * FROM appeals WHERE id = ?').get(app1.id);
  const checkVotes = freshDb.prepare('SELECT * FROM votes WHERE appeal_id = ?').all(app1.id);
  const checkWarns = freshDb.prepare('SELECT * FROM warnings WHERE appeal_id = ?').all(app1.id);

  console.log('   Restarted DB - Appeal Code:', checkApp1.appeal_code, '| Status:', checkApp1.status);
  console.log('   Restarted DB - Votes Count:', checkVotes.length);
  console.log('   Restarted DB - Warnings Count:', checkWarns.length);

  if (checkApp1.status !== 'APPROVED' || checkVotes.length !== 2 || checkWarns.length !== 2) {
    throw new Error('Test 11/20 Failed');
  }

  // Bersihkan data uji agar database kembali bersih
  freshDb.exec(`
    DELETE FROM warnings; 
    DELETE FROM votes; 
    DELETE FROM appeals; 
    DELETE FROM sqlite_sequence WHERE name IN ('appeals', 'votes', 'warnings');
  `);
  console.log('\n   Database uji dibersihkan dan siap untuk pengajuan riil.');
  console.log('\n====================================================');
  console.log('=== ALL 20 MANDATORY TESTS PASSED 100% PERFECTLY ===');
  console.log('====================================================');
}

run20MandatoryTests().catch((err) => {
  console.error('\n❌ MANDATORY TEST FAILED:', err);
  process.exit(1);
});
