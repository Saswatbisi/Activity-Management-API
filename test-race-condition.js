/**
 * Race Condition Test Script
 *
 * This script simulates multiple users trying to register for an activity
 * with only 1 spot remaining — at the exact same time.
 *
 * Expected result: Only 1 registration succeeds, all others fail gracefully.
 *
 * Usage: node test-race-condition.js
 */

const http = require('http');

const API_BASE = 'http://localhost:3000';

// Helper: Make HTTP request
function makeRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runRaceTest() {
  console.log('═══════════════════════════════════════════════════');
  console.log('🏁 RACE CONDITION TEST — Activity Registration');
  console.log('═══════════════════════════════════════════════════\n');

  // Step 1: Register multiple test users
  const numUsers = 5;
  const users = [];

  console.log(`📝 Creating ${numUsers} test users...\n`);

  for (let i = 1; i <= numUsers; i++) {
    const result = await makeRequest('POST', '/api/auth/register', {
      name: `RaceTest User ${i}`,
      email: `racetest${i}_${Date.now()}@test.com`,
      password: 'test123',
    });

    if (result.status === 201) {
      users.push({
        name: result.body.data.user.name,
        token: result.body.data.token,
        id: result.body.data.user._id,
      });
      console.log(`   ✅ Created: ${result.body.data.user.name}`);
    } else {
      console.log(`   ❌ Failed to create user ${i}: ${result.body.message}`);
    }
  }

  // Step 2: Create an activity with only 1 spot
  console.log('\n📌 Creating activity with maxParticipants = 1...\n');

  const activityResult = await makeRequest(
    'POST',
    '/api/activities',
    {
      title: 'Race Condition Test Event',
      description: 'Only 1 spot available — who gets it?',
      date: new Date(Date.now() + 86400000).toISOString(),
      location: 'Test Arena',
      maxParticipants: 1,
    },
    users[0].token
  );

  if (activityResult.status !== 201) {
    console.log('❌ Failed to create activity:', activityResult.body.message);
    return;
  }

  const activityId = activityResult.body.data._id;
  console.log(`   ✅ Activity created: ${activityId}`);
  console.log(`   📊 Max Participants: 1\n`);

  // Step 3: Fire ALL registrations simultaneously
  console.log('───────────────────────────────────────────────────');
  console.log(`🚀 Firing ${numUsers} concurrent registration requests...`);
  console.log('───────────────────────────────────────────────────\n');

  const startTime = Date.now();

  // Create all requests and fire them at the exact same time
  const registrationPromises = users.map((user) =>
    makeRequest('POST', `/api/activities/${activityId}/register`, {}, user.token)
      .then((result) => ({
        user: user.name,
        status: result.status,
        success: result.body.success,
        message: result.body.message,
      }))
      .catch((err) => ({
        user: user.name,
        status: 'ERROR',
        success: false,
        message: err.message,
      }))
  );

  // Wait for all to complete
  const results = await Promise.all(registrationPromises);
  const elapsed = Date.now() - startTime;

  // Step 4: Display results
  console.log('📊 RESULTS:');
  console.log('───────────────────────────────────────────────────');

  let successCount = 0;
  let failCount = 0;

  results.forEach((r) => {
    const icon = r.success ? '✅' : '❌';
    console.log(`   ${icon} ${r.user}: [${r.status}] ${r.message}`);
    if (r.success) successCount++;
    else failCount++;
  });

  console.log('\n───────────────────────────────────────────────────');
  console.log(`   ⏱️  Total time: ${elapsed}ms`);
  console.log(`   ✅ Successful registrations: ${successCount}`);
  console.log(`   ❌ Rejected registrations: ${failCount}`);
  console.log('───────────────────────────────────────────────────\n');

  // Step 5: Verify final state
  const finalActivity = await makeRequest(
    'GET',
    `/api/activities/${activityId}`,
    null,
    users[0].token
  );

  console.log('📋 FINAL ACTIVITY STATE:');
  console.log(`   Current Participants: ${finalActivity.body.data.currentParticipants}`);
  console.log(`   Max Participants: ${finalActivity.body.data.maxParticipants}`);
  console.log(`   Available Spots: ${finalActivity.body.data.availableSpots}`);

  // Verdict
  console.log('\n═══════════════════════════════════════════════════');
  if (successCount === 1) {
    console.log('🏆 TEST PASSED! Only 1 user registered — race condition handled correctly!');
  } else if (successCount === 0) {
    console.log('⚠️  No registrations succeeded. Check server logs.');
  } else {
    console.log(`⚠️  ${successCount} users registered (expected 1). Race condition may not be fully handled.`);
  }
  console.log('═══════════════════════════════════════════════════\n');
}

runRaceTest().catch(console.error);
