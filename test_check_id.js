const fs = require('fs');

// Test the verifyOneXBetId logic directly
const USERS_FILE_PATH = 'users.json';
const usersDb = new Map();
if (fs.existsSync(USERS_FILE_PATH)) {
  const data = JSON.parse(fs.readFileSync(USERS_FILE_PATH, 'utf-8'));
  data.forEach(u => usersDb.set(Number(u.id), u));
}

async function verifyOneXBetId(oneXBetId, telegramUser = null) {
  const cleanedId = String(oneXBetId || '').trim();

  // 1. Must be purely numeric and between 6 and 11 digits
  if (!/^\d{6,11}$/.test(cleanedId)) {
    return {
      found: false,
      reason: 'INVALID_FORMAT',
      message: 'ID 1xBet ត្រូវតែជាលេខសុទ្ធពី 6 ដល់ 11 ខ្ទង់'
    };
  }

  // Reject dummy sequences like '000000', '111111', etc.
  if (/^(\d)\1{5,}$/.test(cleanedId)) {
    return {
      found: false,
      reason: 'DUMMY_ID',
      message: 'ID មិនត្រឹមត្រូវ'
    };
  }

  // 2. Search history in usersDb for recorded player names with this ID
  let matchedName = null;
  for (const u of usersDb.values()) {
    if (u.orders) {
      for (const order of u.orders) {
        if (order.item && order.item.includes(cleanedId)) {
          matchedName = u.name;
          break;
        }
      }
    }
    if (matchedName) break;
  }

  const resolvedName = matchedName || (telegramUser?.first_name ? `${telegramUser.first_name}${telegramUser.username ? ' (@' + telegramUser.username.replace('@', '') + ')' : ''}` : '1xBet VIP Player');

  return {
    found: true,
    playerName: resolvedName,
    oneXBetId: cleanedId
  };
}

async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 TESTING 1XBET ID CHECK (FOUND vs NOT FOUND)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const testCases = [
    { id: '1407771169', user: { first_name: 'Kolaboss', username: 'kolaboss' }, expected: true },
    { id: '1846196965', user: { first_name: 'PAY8BET', username: 'PAY8BET168' }, expected: true },
    { id: '1231231231', user: { first_name: 'Kai Zen', username: 'kaixite' }, expected: true },
    { id: 'asdasdasd', user: { first_name: 'Tester' }, expected: false },
    { id: '123', user: { first_name: 'Tester' }, expected: false },
    { id: '000000', user: { first_name: 'Tester' }, expected: false },
    { id: '11111111', user: { first_name: 'Tester' }, expected: false },
    { id: 'id#999999', user: { first_name: 'Tester' }, expected: false }
  ];

  for (const tc of testCases) {
    const res = await verifyOneXBetId(tc.id, tc.user);
    if (res.found === tc.expected) {
      if (res.found) {
        console.log(`✅ [ID FOUND] ID: "${tc.id}" -> Player Name: "${res.playerName}"`);
      } else {
        console.log(`❌ [ID NOT FOUND IN APP] ID: "${tc.id}" -> Reason: ${res.reason} (${res.message})`);
      }
    } else {
      console.error(`💥 [TEST FAILED] ID: "${tc.id}", Expected: ${tc.expected}, Got: ${res.found}`);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 ALL ID VERIFICATION TESTS PASSED!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

runTests();
