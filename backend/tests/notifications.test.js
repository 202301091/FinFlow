import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { connectRedis, disconnectRedis, isRedisAvailable } from '../src/config/redis.js';
import {
  createNotification,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  publishNotification,
} from '../src/services/notification.service.js';

let server;
let baseUrl;
let senderUserId;
let receiverUserId;
let senderAccountId;
let receiverAccountId;
let senderToken;
let receiverToken;

before(async () => {
  // 1. Connect Redis
  await connectRedis();

  // 2. Fetch test accounts from PostgreSQL
  const accountsRes = await pool.query(`
    SELECT a.id as account_id, a.user_id, a.balance, u.name, u.email
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    WHERE a.status = 'active'
    ORDER BY a.created_at ASC
  `);

  if (accountsRes.rows.length < 2) {
    throw new Error('Test requires at least 2 active accounts in PostgreSQL');
  }

  const senderRow = accountsRes.rows[0];
  const receiverRow =
    accountsRes.rows.find((r) => r.user_id !== senderRow.user_id) || accountsRes.rows[1];

  senderUserId = senderRow.user_id;
  receiverUserId = receiverRow.user_id;
  senderAccountId = senderRow.account_id;
  receiverAccountId = receiverRow.account_id;

  // Ensure sender has sufficient balance
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [senderAccountId]);

  // Clean previous notifications for test users
  await pool.query('DELETE FROM notifications WHERE user_id IN ($1, $2)', [
    senderUserId,
    receiverUserId,
  ]);

  const secret = process.env.JWT_Access_SECRET || 'finflow_access_secret_key_2026';

  senderToken = jwt.sign(
    { id: senderUserId, name: senderRow.name, email: senderRow.email },
    secret,
    { expiresIn: '1h' }
  );

  receiverToken = jwt.sign(
    { id: receiverUserId, name: receiverRow.name, email: receiverRow.email },
    secret,
    { expiresIn: '1h' }
  );

  // 3. Start ephemeral HTTP server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.query('DELETE FROM notifications WHERE user_id IN ($1, $2)', [
    senderUserId,
    receiverUserId,
  ]);
  await disconnectRedis();
  await pool.end();
});

// Helper for making HTTP JSON requests
async function makeRequest({ url, method = 'GET', headers = {}, body = null }) {
  const reqHeaders = { ...headers };
  let payload = null;

  if (body) {
    reqHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
    reqHeaders['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch {
          json = rawData;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Notification Suite: Persistence, Dual Dispatch, REST API, and Live SSE Stream', async (t) => {
  // --------------------------------------------------------------------------
  // 1. Core Service Unit / DB Tests
  // --------------------------------------------------------------------------
  await t.test('1. Notification service creates and retrieves notifications in PostgreSQL', async () => {
    const notif = await createNotification({
      userId: receiverUserId,
      type: 'ACCOUNT_ALERT',
      title: 'Welcome to FinFlow',
      message: 'Your account is ready to send and receive funds.',
      metadata: { source: 'system' },
    });

    assert.ok(notif.id, 'Created notification should have a UUID');
    assert.equal(notif.user_id, receiverUserId);
    assert.equal(notif.type, 'ACCOUNT_ALERT');
    assert.equal(notif.is_read, false);

    const history = await getUserNotifications({ userId: receiverUserId });
    assert.ok(history.notifications.length >= 1);
    assert.ok(history.unreadCount >= 1);
  });

  await t.test('2. Marking single notification and all notifications as read updates status', async () => {
    // Insert another unread notification
    const testNotif = await createNotification({
      userId: receiverUserId,
      type: 'SECURITY_ALERT',
      title: 'New Login',
      message: 'Login detected from a new browser.',
      metadata: {},
    });

    // Mark single as read
    const updated = await markNotificationAsRead({
      userId: receiverUserId,
      notificationId: testNotif.id,
    });
    assert.equal(updated.is_read, true);

    // Mark all as read
    const bulkResult = await markAllNotificationsAsRead({ userId: receiverUserId });
    assert.ok(bulkResult.updatedCount >= 1);

    const check = await getUserNotifications({ userId: receiverUserId });
    assert.equal(check.unreadCount, 0, 'Unread count should be 0 after marking all as read');
  });

  // --------------------------------------------------------------------------
  // 2. Transfer Dual Dispatch Test
  // --------------------------------------------------------------------------
  await t.test('3. transferFunds automatically dispatches dual notifications to sender and receiver', async () => {
    // Clear notifications before transfer
    await pool.query('DELETE FROM notifications WHERE user_id IN ($1, $2)', [
      senderUserId,
      receiverUserId,
    ]);

    const transferAmount = 75.5;
    const idempotencyKey = crypto.randomUUID();

    const res = await makeRequest({
      url: `${baseUrl}/api/v1/transactions/transfer`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${senderToken}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: {
        senderAccountId: senderAccountId,
        receiverAccountId: receiverAccountId,
        amount: transferAmount,
        description: 'Dual notification integration test transfer',
      },
    });

    assert.equal(res.status, 200, `Transfer should succeed: ${JSON.stringify(res.body)}`);

    // Verify Sender Notification in DB
    const senderNotifs = await getUserNotifications({ userId: senderUserId });
    assert.ok(senderNotifs.notifications.length >= 1, 'Sender should receive a notification');
    const senderAlert = senderNotifs.notifications.find((n) => n.type === 'TRANSFER_SENT');
    assert.ok(senderAlert, 'Sender notification type should be TRANSFER_SENT');
    assert.ok(senderAlert.message.includes('₹75.50'), 'Sender message should mention transfer amount');
    assert.equal(senderAlert.is_read, false);

    // Verify Receiver Notification in DB
    const receiverNotifs = await getUserNotifications({ userId: receiverUserId });
    assert.ok(receiverNotifs.notifications.length >= 1, 'Receiver should receive a notification');
    const receiverAlert = receiverNotifs.notifications.find((n) => n.type === 'TRANSFER_RECEIVED');
    assert.ok(receiverAlert, 'Receiver notification type should be TRANSFER_RECEIVED');
    assert.ok(receiverAlert.message.includes('₹75.50'), 'Receiver message should mention credit amount');
    assert.equal(receiverAlert.is_read, false);
  });

  // --------------------------------------------------------------------------
  // 3. REST API Endpoint Tests
  // --------------------------------------------------------------------------
  await t.test('4. GET /api/v1/notifications returns paginated user notification list', async () => {
    const res = await makeRequest({
      url: `${baseUrl}/api/v1/notifications?limit=5`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${senderToken}`,
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.notifications));
    assert.ok(typeof res.body.data.unreadCount === 'number');
  });

  await t.test('5. PATCH /api/v1/notifications/read-all marks all notifications read via REST', async () => {
    const res = await makeRequest({
      url: `${baseUrl}/api/v1/notifications/read-all`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${senderToken}`,
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    // Verify unread count is now 0
    const listRes = await makeRequest({
      url: `${baseUrl}/api/v1/notifications`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${senderToken}`,
      },
    });
    assert.equal(listRes.body.data.unreadCount, 0);
  });

  await t.test('6. Unauthenticated requests to /api/v1/notifications are rejected with 401', async () => {
    const res = await makeRequest({
      url: `${baseUrl}/api/v1/notifications`,
      method: 'GET',
    });
    assert.equal(res.status, 401);
  });

  // --------------------------------------------------------------------------
  // 4. Live Server-Sent Events (SSE) & Redis Pub/Sub Streaming
  // --------------------------------------------------------------------------
  await t.test('7. Real-time SSE stream receives live broadcasted notification via Redis Pub/Sub', async () => {
    assert.equal(isRedisAvailable(), true, 'Redis must be available for SSE pub/sub test');

    const streamUrl = `${baseUrl}/api/v1/notifications/stream?token=${encodeURIComponent(receiverToken)}`;

    let resolveConnected;
    const connectedPromise = new Promise((resolve) => {
      resolveConnected = resolve;
    });

    let resolveLiveEvent;
    const liveEventPromise = new Promise((resolve) => {
      resolveLiveEvent = resolve;
    });

    const req = http.request(
      streamUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'text/event-stream');

        res.on('data', (chunk) => {
          const raw = chunk.toString();
          const lines = raw.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.replace('data: ', '').trim());
                if (parsed.type === 'CONNECTED') {
                  resolveConnected(parsed);
                } else if (parsed.type === 'LIVE_BROADCAST_TEST') {
                  resolveLiveEvent(parsed);
                }
              } catch {
                // Ignore parse errors from comments/keepalives
              }
            }
          }
        });
      }
    );

    req.end();

    // 1. Wait for SSE handshake connection
    const connectedEvent = await connectedPromise;
    assert.equal(connectedEvent.type, 'CONNECTED');
    assert.equal(connectedEvent.userId, receiverUserId);

    // Give Redis subscription a moment to register
    await new Promise((r) => setTimeout(r, 100));

    // 2. Publish live event to receiver
    await publishNotification(receiverUserId, {
      type: 'LIVE_BROADCAST_TEST',
      title: 'Real-time alert',
      message: 'Testing instant Redis pub/sub push to SSE client',
    });

    // 3. Verify event is received over the SSE stream
    const liveEvent = await liveEventPromise;
    assert.equal(liveEvent.type, 'LIVE_BROADCAST_TEST');
    assert.equal(liveEvent.title, 'Real-time alert');
    assert.equal(liveEvent.message, 'Testing instant Redis pub/sub push to SSE client');

    // 4. Terminate connection cleanly
    req.destroy();
  });
});
