const admin = require('firebase-admin');
require('dotenv').config();

try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase Admin SDKが正常に初期化されました。");
} catch (error) {
  console.error("Firebase Admin SDKの初期化に失敗:", error.message);
  process.exit(1);
}

module.exports = admin.firestore();