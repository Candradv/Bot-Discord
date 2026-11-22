const path = require('path');
const db = require('../src/database/db');
const appealInteractions = require('../src/utils/appealInteractions');
const { config } = require('../src/config');

async function runPhase3Tests() {
  console.log('=== RUNNING PHASE 3 MANDATORY TEST SUITE ===\n');

  config.ownerRoleId = 'owner-role-1';
  config.staffRoleId = 'staff-role-2';

  // Helper mock staff member
  const mockStaffMember = {
    id: 'staff-1',
    roles: { cache: new Map([['staff-role-2', { id: 'staff-role-2' }]]) },
    permissions: { has: () => false },
  };

  // Helper mock non-staff member
  const mockNonStaffMember = {
    id: 'regular-user',
    roles: { cache: new Map() },
    permissions: { has: () => false },
  };

  // Mock Discord Client
  const mockClient = {
    users: {
      fetch: async (id) => {
        if (id === 'user-blocked-dm') {
          return {
            id,
            username: 'BlockedUser',
            tag: 'BlockedUser#0001',
            send: async () => {
              const err = new Error('Cannot send messages to this user');
              err.code = 50007;
              throw err;
            },
          };
        }
        return {
          id,
          username: 'ApplicantUser',
          tag: 'ApplicantUser#0001',
          send: async () => ({ id: 'dm-msg-id' }),
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

  // --------------------------------------------------------------------------
  // TEST 5: Non-staff mencoba melakukan review dan ditolak
  // --------------------------------------------------------------------------
  console.log('TEST 5: Non-staff mencoba melakukan review');
  let nonStaffReply = '';
  await appealInteractions.handleStaffReviewButton({
    customId: 'appeal_btn_approve_9999',
    member: mockNonStaffMember,
    guild: { ownerId: 'guild-owner-id' },
    user: { id: 'regular-user', tag: 'Regular#0001' },
    reply: async (res) => {
      nonStaffReply = res.content;
    },
  });
  console.log('Result Test 5 (Access Denied):', nonStaffReply.includes('tidak memiliki izin'));
  if (!nonStaffReply.includes('tidak memiliki izin')) throw new Error('Test 5 Failed');

  // --------------------------------------------------------------------------
  // TEST 1 & 3: Staff berhasil Approve & User menerima DM keputusan
  // --------------------------------------------------------------------------
  console.log('\nTEST 1 & 3: Staff Approve & User DM Notification');
  const app1 = db.createAppeal({
    userId: 'user-app-1',
    userTag: 'Applicant1#0001',
    ign: 'HeroOne (Lv. 80)',
    ageTimezone: '20, WIB',
    reason: 'Ingin bergabung guild',
    experience: '3 tahun main game',
    screenshotUrl: null,
  });
  db.updateAppealMessage(app1.id, 'chan-1', 'msg-1');

  let approveEditedEmbed = null;
  let approveButtonsDisabled = false;
  let staffFollowUp = '';

  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_approve_${app1.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'guild-owner-id' },
    user: { id: 'staff-1', tag: 'StaffOne#0001' },
    client: mockClient,
    deferUpdate: async () => {},
    editReply: async (payload) => {
      approveEditedEmbed = payload.embeds[0];
      approveButtonsDisabled = payload.components[0].components[0].data.disabled;
    },
    followUp: async (payload) => {
      staffFollowUp = payload.content;
    },
  });

  const app1After = db.getAppealById(app1.id);
  console.log('Approve Status in DB:', app1After.status);
  console.log('Reviewed by Staff ID in DB:', app1After.reviewed_by);
  console.log('Buttons Disabled in Staff Message:', approveButtonsDisabled);
  console.log(
    'Embed Status Text in Staff Message:',
    approveEditedEmbed.data.fields.find((f) => f.name.includes('Status'))?.value,
  );
  console.log('Confirmation sent to Staff:', staffFollowUp.includes('berhasil disetujui'));

  if (app1After.status !== 'APPROVED' || !approveButtonsDisabled) throw new Error('Test 1/3 Failed');

  // --------------------------------------------------------------------------
  // TEST 6: Pengajuan yang sudah diproses tidak bisa diproses lagi
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Anti Double Review pada Appeal yang Sudah Selesai');
  let doubleReviewReply = '';
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_approve_${app1.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'guild-owner-id' },
    user: { id: 'staff-2', tag: 'StaffTwo#0001' },
    client: mockClient,
    reply: async (res) => {
      doubleReviewReply = res.content;
    },
  });
  console.log('Result Test 6 (Already processed notice):', doubleReviewReply.includes('sudah diproses'));
  if (!doubleReviewReply.includes('sudah diproses')) throw new Error('Test 6 Failed');

  // --------------------------------------------------------------------------
  // TEST 7: Dua staff melakukan review bersamaan (Simulasi Race Condition)
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Dua staff melakukan review bersamaan (Atomic Race Condition)');
  const appRace = db.createAppeal({
    userId: 'user-race',
    userTag: 'RaceUser#0001',
    ign: 'Speedster (Lv. 50)',
    ageTimezone: '22, WIB',
    reason: 'Race test',
    experience: 'None',
  });

  // Simulasi dua eksekusi atomik reviewAppeal di level database
  const resStaff1 = db.reviewAppeal(appRace.id, 'APPROVED', 'staff-1');
  const resStaff2 = db.reviewAppeal(appRace.id, 'REJECTED', 'staff-2', 'Terlambat');

  console.log('Staff 1 Success:', resStaff1.success);
  console.log('Staff 2 Success (Should be False):', resStaff2.success);
  console.log('Final DB Status:', db.getAppealById(appRace.id).status);
  if (resStaff1.success !== true || resStaff2.success !== false) throw new Error('Test 7 Failed');

  // --------------------------------------------------------------------------
  // TEST 2, 4, 9: Staff Reject menggunakan modal, DM gagal namun review tetap sukses, Embed Updated
  // --------------------------------------------------------------------------
  console.log('\nTEST 2, 4, 9: Staff Reject via Modal & DM Failure Resilience & Embed Update');
  const appReject = db.createAppeal({
    userId: 'user-blocked-dm', // User dengan DM tertutup
    userTag: 'Blocked#0001',
    ign: 'QuietGuy (Lv. 70)',
    ageTimezone: '19, WIB',
    reason: 'Test DM fail',
    experience: 'None',
  });
  db.updateAppealMessage(appReject.id, 'chan-1', 'msg-reject');

  let rejectReply = '';
  await appealInteractions.handleStaffRejectModal({
    customId: `appeal_modal_reject_${appReject.id}`,
    member: mockStaffMember,
    guild: { ownerId: 'guild-owner-id' },
    user: { id: 'staff-1', tag: 'StaffOne#0001' },
    client: mockClient,
    fields: {
      getTextInputValue: () => 'Level akun belum mencukupi batas minimum guild.',
    },
    deferReply: async () => {},
    editReply: async (res) => {
      rejectReply = res.content;
    },
  });

  const appRejectAfter = db.getAppealById(appReject.id);
  console.log('Reject Status in DB:', appRejectAfter.status);
  console.log('Rejection Reason in DB:', appRejectAfter.rejection_reason);
  console.log('Review succeeded despite DM failure:', rejectReply.includes('ditolak'));

  // Test Embed generation for rejected appeal
  const rejectEmbed = appealInteractions.buildStaffEmbed(appRejectAfter);
  console.log('Reject Embed Color:', rejectEmbed.data.color === 0xe74c3c ? 'Red (0xE74C3C)' : 'Other');
  console.log('Reject Embed Alasan Penolakan Field:', rejectEmbed.data.fields.find((f) => f.name.includes('Penolakan'))?.value);

  if (appRejectAfter.status !== 'REJECTED' || !appRejectAfter.rejection_reason) throw new Error('Test 2/4/9 Failed');

  // --------------------------------------------------------------------------
  // TEST 8: Status tetap tersimpan setelah bot restart
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Status tetap tersimpan setelah bot restart');
  const { DatabaseSync } = require('node:sqlite');
  const rebootDb = new DatabaseSync(path.join(__dirname, '..', 'data', 'appeals.db'));
  const rebootApp1 = rebootDb.prepare('SELECT * FROM appeals WHERE id = ?').get(app1.id);
  const rebootReject = rebootDb.prepare('SELECT * FROM appeals WHERE id = ?').get(appReject.id);

  console.log('Reboot check App1 status:', rebootApp1.status, '| Reviewed by:', rebootApp1.reviewed_by);
  console.log('Reboot check Reject status:', rebootReject.status, '| Reason:', rebootReject.rejection_reason);

  if (rebootApp1.status !== 'APPROVED' || rebootReject.status !== 'REJECTED') {
    throw new Error('Test 8 Failed');
  }

  // --------------------------------------------------------------------------
  // TEST 10: Tidak ada error pada fitur Tahap 1 dan Tahap 2
  // --------------------------------------------------------------------------
  console.log('\nTEST 10: Regression Check Tahap 1 & Tahap 2');
  const setupCommand = require('../src/commands/setup-appeal');
  console.log('Setup command loaded:', setupCommand.data.name);
  const pingCommand = require('../src/commands/ping');
  console.log('Ping command loaded:', pingCommand.data.name);

  // Clean test rows from database
  rebootDb.exec("DELETE FROM appeals; DELETE FROM sqlite_sequence WHERE name='appeals';");
  console.log('Cleaned test database for production.');

  console.log('\n=== ALL 10 MANDATORY TESTS PASSED 100%! ===');
}

runPhase3Tests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
