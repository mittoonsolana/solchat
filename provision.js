// One-time Appwrite provisioning script to create SolChat Global DB/collection
// NOTE: This uses a server API key. Do NOT bundle this file in client builds.
// After running successfully, you should delete this file from your repo.

const { Client, Databases, ID, Permission, Role } = require('node-appwrite');

const APPWRITE_ENDPOINT = 'https://nyc.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '690874e400173bad91d8';
// Provided by user (server-side only). Remove after provisioning.
const APPWRITE_API_KEY = 'standard_58a7be17a198b8e27fe76e9949e8d67f812cc073ac70cd823caee2f651cba142ade662ee75219165abc0b077975114c592d1146ac5d933395282bc3fab8e65adf0c023a106d7c82d7e1db963350f1e6a156ec42314562b2d0c6debae27bf2981e3f391851727951060c161fc4dbf695bdb21ac6df77f50d8cd6cb6c9c6a2c6df';

const DATABASE_ID = 'solchat_global';
const COLLECTION_ID = 'messages';
const PRESENCE_COLLECTION_ID = 'presence';

async function main() {
  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  const databases = new Databases(client);

  // Create database if missing
  try {
    try {
      await databases.get(DATABASE_ID);
      console.log('Database exists:', DATABASE_ID);
    } catch (_) {
      await databases.create(DATABASE_ID, 'SolChat Global');
      console.log('Created database:', DATABASE_ID);
    }

    // Create collection if missing
    try {
      await databases.getCollection(DATABASE_ID, COLLECTION_ID);
      console.log('Collection exists:', COLLECTION_ID);
    } catch (_) {
      await databases.createCollection(DATABASE_ID, COLLECTION_ID, 'Messages');
      console.log('Created collection:', COLLECTION_ID);
    }

    // Ensure document security is enabled and allow users to create documents
    try {
      await databases.updateCollection(
        DATABASE_ID,
        COLLECTION_ID,
        'Messages',
        [
          Permission.create(Role.users()),
        ],
        true // documentSecurity: true
      );
      console.log('Updated collection: documentSecurity enabled; create: users');
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('no changes') || err?.code === 400) {
        console.log('Collection update skipped (no changes).');
      } else {
        throw err;
      }
    }

    // Create attributes (idempotent)
    await ensureStringAttribute(databases, 'userId', 64, true);
    await ensureStringAttribute(databases, 'username', 64, true);
    await ensureStringAttribute(databases, 'content', 400, true);
    await ensureStringAttribute(databases, 'replyTo', 64, false);
    await ensureDatetimeAttribute(databases, 'timestamp', true);

    // Create index for ordering by timestamp (idempotent)
    await ensureTimestampIndex(databases);

    // Presence collection
    try {
      await databases.getCollection(DATABASE_ID, PRESENCE_COLLECTION_ID);
      console.log('Collection exists:', PRESENCE_COLLECTION_ID);
    } catch (_) {
      await databases.createCollection(DATABASE_ID, PRESENCE_COLLECTION_ID, 'Presence');
      console.log('Created collection:', PRESENCE_COLLECTION_ID);
    }

    try {
      await databases.updateCollection(
        DATABASE_ID,
        PRESENCE_COLLECTION_ID,
        'Presence',
        [Permission.create(Role.users())],
        true
      );
      console.log('Updated presence collection: documentSecurity enabled; create: users');
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('no changes') || err?.code === 400) {
        console.log('Presence collection update skipped (no changes).');
      } else {
        throw err;
      }
    }

    await ensureStringAttribute(databases, 'userId', 64, true, PRESENCE_COLLECTION_ID);
    await ensureStringAttribute(databases, 'username', 64, true, PRESENCE_COLLECTION_ID);
    await ensureStringAttribute(databases, 'avatar', 32, false, PRESENCE_COLLECTION_ID);
    await ensureStringAttribute(databases, 'status', 16, true, PRESENCE_COLLECTION_ID);
    await ensureDatetimeAttribute(databases, 'updatedAt', true, PRESENCE_COLLECTION_ID);
    await ensurePresenceIndex(databases);

    // Wait briefly for attributes to become available
    await delay(4000);
    console.log('Provisioning complete. You can now use the chat app.');
  } catch (err) {
    console.error('Provisioning error:', err?.message || err);
    process.exit(1);
  }
}

async function ensureStringAttribute(databases, key, size, required, collection = COLLECTION_ID) {
  try {
    await databases.createStringAttribute(DATABASE_ID, collection, key, size, required);
    console.log(`Created string attribute: ${key}`);
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('already') || err?.code === 409) {
      console.log(`Attribute exists: ${key}`);
    } else {
      throw err;
    }
  }
}

async function ensureDatetimeAttribute(databases, key, required, collection = COLLECTION_ID) {
  try {
    await databases.createDatetimeAttribute(DATABASE_ID, collection, key, required);
    console.log(`Created datetime attribute: ${key}`);
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('already') || err?.code === 409) {
      console.log(`Attribute exists: ${key}`);
    } else {
      throw err;
    }
  }
}

function delay(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function ensureTimestampIndex(databases) {
  try {
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      'idx_timestamp',
      'key',
      ['timestamp'],
      ['asc']
    );
    console.log('Created index: idx_timestamp (timestamp asc)');
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('already') || err?.code === 409) {
      console.log('Index exists: idx_timestamp');
    } else {
      throw err;
    }
  }
}

async function ensurePresenceIndex(databases) {
  try {
    await databases.createIndex(
      DATABASE_ID,
      PRESENCE_COLLECTION_ID,
      'idx_presence_updated',
      'key',
      ['updatedAt'],
      ['desc']
    );
    console.log('Created index: idx_presence_updated (updatedAt desc)');
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('already') || err?.code === 409) {
      console.log('Index exists: idx_presence_updated');
    } else {
      throw err;
    }
  }
}

main();