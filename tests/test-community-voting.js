const path = require('path');
const db = require('../src/database/db');
const appealInteractions = require('../src/utils/appealInteractions');
const { config } = require('../src/config');

async function testCommunityVoting() {
  console.log('=== TEST PUBLIC COMMUNITY VOTING SYSTEM ===\n');

  config.ownerRoleId = 'owner-role-1';
  config.staffRoleId = 'staff-role-2';

  // 1. Buat appeal uji baru
  const testAppeal = db.createAppeal({
    userId: 'applicant-vote-test',
    userTag: 'ApplicantVote#0001',
    ign: 'VoterTarget (Lv. 75)',
    ageTimezone: '21, WIB',
    reason: 'Testing public community voting',
    experience: 'Active player',
    screenshotUrl: null,
  });
  console.log('1. Appeal Dibuat:', testAppeal.appeal_code, '(ID:', testAppeal.id, ')');

  // Periksa hitungan vote awal
  let counts = db.getVoteCounts(testAppeal.id);
  console.log('   Hitungan awal:', counts);
  if (counts.support !== 0 || counts.against !== 0 || counts.total !== 0) {
    throw new Error('Initial vote counts should be 0');
  }

  // 2. Member 1 memberikan vote 👍 Support
  console.log('\n2. Member 1 memberikan vote 👍 Support:');
  let member1Reply = '';
  let updatedEmbed1 = null;
  const mockMember1Interaction = {
    customId: `appeal_btn_vote_support_${testAppeal.id}`,
    user: { id: 'member-1', tag: 'MemberOne#0001' },
    deferUpdate: async () => {},
    editReply: async (payload) => {
      updatedEmbed1 = payload.embeds[0];
    },
    followUp: async (payload) => {
      member1Reply = payload.content;
    },
  };

  await appealInteractions.handleCommunityVoteButton(mockMember1Interaction);
  counts = db.getVoteCounts(testAppeal.id);
  console.log('   Hitungan setelah Member 1:', counts);
  console.log('   Balasan ephemeral Member 1:', member1Reply);
  console.log(
    '   Field voting pada Embed:',
    updatedEmbed1.data.fields.find((f) => f.name === '📊 Community Voting')?.value
  );
  if (counts.support !== 1 || counts.against !== 0 || counts.total !== 1) {
    throw new Error('Vote Member 1 failed');
  }

  // 3. Member 2 memberikan vote 👎 Against
  console.log('\n3. Member 2 memberikan vote 👎 Against:');
  let member2Reply = '';
  let updatedEmbed2 = null;
  const mockMember2Interaction = {
    customId: `appeal_btn_vote_against_${testAppeal.id}`,
    user: { id: 'member-2', tag: 'MemberTwo#0002' },
    deferUpdate: async () => {},
    editReply: async (payload) => {
      updatedEmbed2 = payload.embeds[0];
    },
    followUp: async (payload) => {
      member2Reply = payload.content;
    },
  };

  await appealInteractions.handleCommunityVoteButton(mockMember2Interaction);
  counts = db.getVoteCounts(testAppeal.id);
  console.log('   Hitungan setelah Member 2:', counts);
  console.log(
    '   Field voting pada Embed:',
    updatedEmbed2.data.fields.find((f) => f.name === '📊 Community Voting')?.value
  );
  if (counts.support !== 1 || counts.against !== 1 || counts.total !== 2) {
    throw new Error('Vote Member 2 failed');
  }

  // 4. Member 2 mengganti pilihan voting menjadi 👍 Support
  console.log('\n4. Member 2 mengganti pilihan voting menjadi 👍 Support:');
  let member2ChangeReply = '';
  let updatedEmbed2Change = null;
  const mockMember2ChangeInteraction = {
    customId: `appeal_btn_vote_support_${testAppeal.id}`,
    user: { id: 'member-2', tag: 'MemberTwo#0002' },
    deferUpdate: async () => {},
    editReply: async (payload) => {
      updatedEmbed2Change = payload.embeds[0];
    },
    followUp: async (payload) => {
      member2ChangeReply = payload.content;
    },
  };

  await appealInteractions.handleCommunityVoteButton(mockMember2ChangeInteraction);
  counts = db.getVoteCounts(testAppeal.id);
  console.log('   Hitungan setelah Member 2 ganti pilihan:', counts);
  console.log('   Balasan ephemeral pergantian vote:', member2ChangeReply);
  if (counts.support !== 2 || counts.against !== 0 || counts.total !== 2) {
    throw new Error('Vote change for Member 2 failed');
  }

  // 5. Member 1 mengklik vote yang sama lagi (tidak boleh ada duplikasi)
  console.log('\n5. Member 1 mengklik 👍 Support lagi (Anti Duplikasi):');
  let member1SameReply = '';
  await appealInteractions.handleCommunityVoteButton({
    customId: `appeal_btn_vote_support_${testAppeal.id}`,
    user: { id: 'member-1', tag: 'MemberOne#0001' },
    deferUpdate: async () => {},
    editReply: async () => {},
    followUp: async (payload) => {
      member1SameReply = payload.content;
    },
  });
  counts = db.getVoteCounts(testAppeal.id);
  console.log('   Hitungan tetap:', counts);
  console.log('   Balasan vote sama:', member1SameReply);
  if (counts.total !== 2) {
    throw new Error('Duplicate vote check failed');
  }

  // 6. Regular member mencoba Approve/Reject (wajib ditolak)
  console.log('\n6. Regular member mencoba Approve/Reject (Harus ditolak):');
  let regularStaffReply = '';
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_approve_${testAppeal.id}`,
    member: { id: 'regular-user', roles: { cache: new Map() }, permissions: { has: () => false } },
    guild: { ownerId: 'guild-owner-id' },
    user: { id: 'regular-user', tag: 'Regular#0001' },
    reply: async (payload) => {
      regularStaffReply = payload.content;
    },
  });
  console.log('   Akses ditolak:', regularStaffReply.includes('tidak memiliki izin'));
  if (!regularStaffReply.includes('tidak memiliki izin')) {
    throw new Error('Permission check for review failed');
  }

  // 7. Staff resmi menyetujui (Approve) appeal
  console.log('\n7. Staff resmi menyetujui (Approve) appeal:');
  const mockStaffClient = {
    users: {
      fetch: async () => ({
        id: 'applicant-vote-test',
        username: 'VoterTarget',
        tag: 'VoterTarget#0001',
        send: async () => ({ id: 'dm-ok' }),
      }),
    },
  };

  let finalEmbed = null;
  let allButtonsDisabled = false;
  await appealInteractions.handleStaffReviewButton({
    customId: `appeal_btn_approve_${testAppeal.id}`,
    member: {
      id: 'staff-user',
      roles: { cache: new Map([['staff-role-2', { id: 'staff-role-2' }]]) },
      permissions: { has: () => false },
    },
    guild: { ownerId: 'guild-owner-id' },
    user: { id: 'staff-user', tag: 'StaffUser#0001' },
    client: mockStaffClient,
    deferUpdate: async () => {},
    editReply: async (payload) => {
      finalEmbed = payload.embeds[0];
      const row1Disabled = payload.components[0].components.every((b) => b.data.disabled === true);
      const row2Disabled = payload.components[1].components.every((b) => b.data.disabled === true);
      allButtonsDisabled = row1Disabled && row2Disabled;
    },
    followUp: async () => {},
  });

  console.log('   Status akhir di Embed:', finalEmbed.data.fields.find((f) => f.name.includes('Status'))?.value);
  console.log('   Hasil voting tetap tampil di Embed:', finalEmbed.data.fields.find((f) => f.name.includes('Voting'))?.value);
  console.log('   Semua tombol (Voting & Staff) nonaktif:', allButtonsDisabled);
  if (!allButtonsDisabled) {
    throw new Error('All buttons should be disabled after official staff decision');
  }

  // 8. Member mencoba vote setelah appeal selesai (Harus ditutup)
  console.log('\n8. Member mencoba vote setelah appeal selesai (Voting Ditutup):');
  let voteAfterClosedReply = '';
  await appealInteractions.handleCommunityVoteButton({
    customId: `appeal_btn_vote_support_${testAppeal.id}`,
    user: { id: 'member-3', tag: 'MemberThree#0003' },
    reply: async (payload) => {
      voteAfterClosedReply = payload.content;
    },
  });
  console.log('   Voting ditutup:', voteAfterClosedReply.includes('ditutup'));
  if (!voteAfterClosedReply.includes('ditutup')) {
    throw new Error('Voting after decision should be rejected');
  }

  // 9. Persistensi restart bot
  console.log('\n9. Uji Persistensi Restart Database:');
  const { DatabaseSync } = require('node:sqlite');
  const rebootDb = new DatabaseSync(path.join(__dirname, '..', 'data', 'appeals.db'));
  const savedVotes = rebootDb.prepare('SELECT * FROM votes WHERE appeal_id = ?').all(testAppeal.id);
  console.log('   Jumlah baris voting tersimpan setelah restart:', savedVotes.length);
  if (savedVotes.length !== 2) {
    throw new Error('Database persistence check failed');
  }

  // Bersihkan data uji
  rebootDb.exec(`DELETE FROM appeals WHERE id = ${testAppeal.id};`);
  console.log('\n=== SEMUA PENGUJIAN COMMUNITY VOTING LULUS 100%! ===');
}

testCommunityVoting().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
